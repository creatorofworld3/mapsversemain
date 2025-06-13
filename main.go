package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
	"github.com/sirupsen/logrus"
)

type Coordinates struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type RouteResponse struct {
	Features []struct {
		Geometry struct {
			Coordinates [][]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"features"`
}

type ConnectedClients struct {
	Delivery *websocket.Conn
	Customer *websocket.Conn
	mu       sync.Mutex
}

type LocationData struct {
	DeliveryCoords *Coordinates `json:"deliveryCoords,omitempty"`
	CustomerCoords *Coordinates `json:"customerCoords,omitempty"`
}

type OrderStatus struct {
	Status string `json:"status"`
	ETA    string `json:"eta,omitempty"`
}

var (
	logger           = logrus.New()
	connectedClients = &ConnectedClients{}
	deliveryCoords   *Coordinates
	customerCoords   *Coordinates
	upgrader         = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

func init() {
	logger.SetFormatter(&logrus.JSONFormatter{})
	logger.SetOutput(os.Stdout)
	logger.SetLevel(logrus.InfoLevel)

	if err := godotenv.Load(); err != nil {
		logger.Warn("No .env file found")
	}
}

func validateCoords(coords *Coordinates) bool {
	if coords == nil || coords.Latitude < -90 || coords.Latitude > 90 || coords.Longitude < -180 || coords.Longitude > 180 {
		logger.Warnf("Invalid coordinates: %+v", coords)
		return false
	}
	return true
}

func tryConnect() {
	if deliveryCoords == nil || customerCoords == nil || connectedClients.Delivery == nil || connectedClients.Customer == nil {
		return
	}

	logger.Info("Attempting to connect delivery and customer with route calculation")

	// Prepare request to OpenRouteService
	url := "https://api.openrouteservice.org/v2/directions/driving-car/geojson"
	body := map[string]interface{}{
		"coordinates": [][]float64{
			{deliveryCoords.Longitude, deliveryCoords.Latitude},
			{customerCoords.Longitude, customerCoords.Latitude},
		},
		"instructions": false,
	}
	bodyBytes, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		logger.Errorf("Failed to create request: %v", err)
		return
	}

	req.Header.Set("Authorization", "Bearer "+os.Getenv("ORS_API_KEY"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, application/geo+json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		logger.Errorf("Failed to fetch route: %v", err)
		sendError(connectedClients.Delivery, "Failed to establish connection")
		sendError(connectedClients.Customer, "Failed to establish connection")
		return
	}
	defer resp.Body.Close()

	var routeResp RouteResponse
	if err := json.NewDecoder(resp.Body).Decode(&routeResp); err != nil {
		logger.Errorf("Failed to decode response: %v", err)
		return
	}

	routeCoords := make([]Coordinates, len(routeResp.Features[0].Geometry.Coordinates))
	for i, coord := range routeResp.Features[0].Geometry.Coordinates {
		routeCoords[i] = Coordinates{Latitude: coord[1], Longitude: coord[0]}
	}

	// Send connection success to both clients
	response := map[string]interface{}{
		"deliveryCoords": deliveryCoords,
		"customerCoords": customerCoords,
		"routeCoords":    routeCoords,
		"orderStatus":    "In Transit",
	}

	connectedClients.mu.Lock()
	if err := connectedClients.Delivery.WriteJSON(response); err != nil {
		logger.Errorf("Failed to send to delivery: %v", err)
	}
	if err := connectedClients.Customer.WriteJSON(response); err != nil {
		logger.Errorf("Failed to send to customer: %v", err)
	}
	connectedClients.mu.Unlock()

	logger.Info("Successfully connected delivery and customer")
}

func sendError(conn *websocket.Conn, message string) {
	if conn != nil {
		conn.WriteJSON(map[string]string{"error": message})
	}
}

func handleConnections(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Errorf("WebSocket upgrade failed: %v", err)
		return
	}
	defer ws.Close()

	logger.Infof("Client connected: %v", ws.RemoteAddr())

	for {
		var msg map[string]interface{}
		err := ws.ReadJSON(&msg)
		if err != nil {
			logger.Errorf("Error reading message: %v", err)
			connectedClients.mu.Lock()
			if connectedClients.Delivery == ws {
				connectedClients.Delivery = nil
				deliveryCoords = nil
				logger.Info("Delivery person disconnected")
			}
			if connectedClients.Customer == ws {
				connectedClients.Customer = nil
				customerCoords = nil
				logger.Info("Customer disconnected")
			}
			connectedClients.mu.Unlock()
			break
		}

		switch msg["type"] {
		case "joinAsDelivery":
			connectedClients.mu.Lock()
			connectedClients.Delivery = ws
			connectedClients.mu.Unlock()
			logger.Info("Delivery person joined")
			ws.WriteJSON(map[string]interface{}{"type": "joinedAsDelivery", "success": true})

		case "joinAsCustomer":
			connectedClients.mu.Lock()
			connectedClients.Customer = ws
			connectedClients.mu.Unlock()
			logger.Info("Customer joined")
			ws.WriteJSON(map[string]interface{}{"type": "joinedAsCustomer", "success": true})

		case "deliveryLocation":
			var data LocationData
			if err := json.Unmarshal([]byte(msg["data"].(string)), &data); err != nil {
				logger.Errorf("Invalid delivery data: %v", err)
				continue
			}
			if !validateCoords(data.DeliveryCoords) {
				sendError(ws, "Invalid delivery coordinates")
				continue
			}
			deliveryCoords = data.DeliveryCoords
			logger.Infof("Delivery location updated: %+v", deliveryCoords)
			connectedClients.mu.Lock()
			if connectedClients.Customer != nil {
				connectedClients.Customer.WriteJSON(map[string]interface{}{
					"type": "deliveryLocation",
					"data": deliveryCoords,
				})
			}
			connectedClients.mu.Unlock()
			tryConnect()

		case "customerLocation":
			var data LocationData
			if err := json.Unmarshal([]byte(msg["data"].(string)), &data); err != nil {
				logger.Errorf("Invalid customer data: %v", err)
				continue
			}
			if !validateCoords(data.CustomerCoords) {
				sendError(ws, "Invalid customer coordinates")
				continue
			}
			customerCoords = data.CustomerCoords
			logger.Infof("Customer location updated: %+v", customerCoords)
			connectedClients.mu.Lock()
			if connectedClients.Delivery != nil {
				connectedClients.Delivery.WriteJSON(map[string]interface{}{
					"type": "customerLocation",
					"data": customerCoords,
				})
			}
			connectedClients.mu.Unlock()
			tryConnect()

		case "updateOrderStatus":
			var status OrderStatus
			if err := json.Unmarshal([]byte(msg["data"].(string)), &status); err != nil {
				logger.Errorf("Invalid status data: %v", err)
				continue
			}
			logger.Infof("Order status updated: %s", status.Status)
			connectedClients.mu.Lock()
			if connectedClients.Delivery != nil {
				connectedClients.Delivery.WriteJSON(map[string]interface{}{
					"type": "orderStatusUpdate",
					"data": status,
				})
			}
			if connectedClients.Customer != nil {
				connectedClients.Customer.WriteJSON(map[string]interface{}{
					"type": "orderStatusUpdate",
					"data": status,
				})
			}
			connectedClients.mu.Unlock()
		}
	}
}

func main() {
	http.HandleFunc("/ws", handleConnections)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	logger.Infof("Server running on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

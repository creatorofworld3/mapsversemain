const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*', // Allow connections from React Native app
    methods: ['GET', 'POST']
  }
});

let deliveryCoords = null;
let customerCoords = null;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle delivery user sending coordinates
  socket.on('deliveryLocation', (coords) => {
    deliveryCoords = coords;
    console.log('Delivery coords received:', deliveryCoords);
    socket.broadcast.emit('deliveryLocation', deliveryCoords); // Send to customer
  });

  // Handle customer sending coordinates
  socket.on('customerLocation', (coords) => {
    customerCoords = coords;
    console.log('Customer coords received:', customerCoords);
    socket.broadcast.emit('customerLocation', customerCoords); // Send to delivery
  });

  // Handle connect request
  socket.on('connectUsers', async () => {
    if (deliveryCoords && customerCoords) {
      console.log('Connecting delivery and customer');
      try {
        // Fetch route from OpenRouteService
        const response = await axios.post(
          'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
          {
            coordinates: [
              [customerCoords.longitude, customerCoords.latitude],
              [deliveryCoords.longitude, deliveryCoords.latitude]
            ],
            instructions: false
          },
          {
            headers: {
              'Authorization': 'Bearer 5b3ce3597851110001cf62486d2c2c7b8ea443aeb5611f95c23fbdd5', // Replace with your API key
              'Content-Type': 'application/json',
              'Accept': 'application/json, application/geo+json'
            }
          }
        );

        if (response.status !== 200) {
          throw new Error(`OpenRouteService API error: ${response.statusText}`);
        }

        const routeCoords = response.data.features[0].geometry.coordinates.map(([lng, lat]) => ({
          latitude: lat,
          longitude: lng
        }));

        // Emit connection and route to both clients
        io.emit('connected', { deliveryCoords, customerCoords, routeCoords });
      } catch (error) {
        socket.emit('error', `Failed to fetch route: ${error.message}`);
      }
    } else {
      socket.emit('error', 'Both users must share coordinates before connecting.');
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
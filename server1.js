const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY'; // Replace with your API key

// In-memory storage (use MongoDB or similar for production)
const orders = new Map();
const deliveryLocations = new Map();

// Order statuses
const ORDER_STATUSES = {
  IDLE: 'idle',
  ASSIGNED: 'assigned',
  GOING_TO_STORE: 'going_to_store',
  AT_STORE: 'at_store',
  PICKED_UP: 'picked_up',
  DELIVERING: 'delivering',
  DELIVERED: 'delivered',
};

// Decode polyline points
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

// Calculate route using Google Maps Directions API
async function calculateRoute(origin, destination) {
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&key=${GOOGLE_MAPS_API_KEY}&mode=driving&traffic_model=best_guess&departure_time=now&units=metric`;
    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== 'OK') {
      throw new Error(`Directions API error: ${data.status}`);
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    return {
      coordinates: decodePolyline(route.overview_polyline.points),
      steps: leg.steps.map(step => ({
        latitude: step.end_location.lat,
        longitude: step.end_location.lng,
        instruction: step.html_instructions.replace(/<[^>]*>/g, ''),
        distance: step.distance.text,
        duration: step.duration.text,
      })),
      totalDistance: leg.distance.text,
      totalDuration: leg.duration_in_traffic?.text || leg.duration.text,
      polylinePoints: route.overview_polyline.points,
    };
  } catch (error) {
    console.error('Route calculation error:', error);
    return null;
  }
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Register delivery person or customer
  socket.on('register', ({ type, userId, orderId }) => {
    socket.join(type === 'delivery' ? `delivery:${userId}` : `customer:${orderId}`);
    console.log(`${type} registered: ${userId || orderId}`);
  });

  // Update delivery person's location
  socket.on('updateLocation', async ({ orderId, location }) => {
    deliveryLocations.set(orderId, location);
    
    // Broadcast to customer
    io.to(`customer:${orderId}`).emit('locationUpdate', { location });

    // Recalculate route if delivering
    const order = orders.get(orderId);
    if (order && order.status === ORDER_STATUSES.DELIVERING) {
      const route = await calculateRoute(location, order.customerLocation);
      if (route) {
        io.to(`delivery:${order.deliveryPersonId}`).emit('routeUpdate', route);
        io.to(`customer:${orderId}`).emit('routeUpdate', route);
      }
    }
  });

  // Update order status
  socket.on('updateOrderStatus', async ({ orderId, status }) => {
    const order = orders.get(orderId);
    if (!order) return;

    order.status = status;
    orders.set(orderId, order);

    const statusUpdate = {
      status,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      description: {
        [ORDER_STATUSES.IDLE]: 'Ready for Assignment',
        [ORDER_STATUSES.ASSIGNED]: 'Delivery Assigned',
        [ORDER_STATUSES.GOING_TO_STORE]: 'Navigate to Restaurant',
        [ORDER_STATUSES.AT_STORE]: 'At Restaurant',
        [ORDER_STATUSES.PICKED_UP]: 'Order Picked Up',
        [ORDER_STATUSES.DELIVERING]: 'Delivering to Customer',
        [ORDER_STATUSES.DELIVERED]: 'Delivery Complete',
      }[status],
    };

    // Broadcast status update
    io.to(`customer:${orderId}`).emit('statusUpdate', statusUpdate);
    io.to(`delivery:${order.deliveryPersonId}`).emit('statusUpdate', statusUpdate);

    // Calculate route if needed
    if (status === ORDER_STATUSES.GOING_TO_STORE) {
      const route = await calculateRoute(deliveryLocations.get(orderId) || order.deliveryPersonLocation, order.storeLocation);
      if (route) {
        io.to(`delivery:${order.deliveryPersonId}`).emit('routeUpdate', route);
        io.to(`customer:${orderId}`).emit('routeUpdate', route);
      }
    } else if (status === ORDER_STATUSES.DELIVERING) {
      const route = await calculateRoute(deliveryLocations.get(orderId) || order.deliveryPersonLocation, order.customerLocation);
      if (route) {
        io.to(`delivery:${order.deliveryPersonId}`).emit('routeUpdate', route);
        io.to(`customer:${orderId}`).emit('routeUpdate', route);
      }
    }
  });

  // Initialize order (for demo purposes)
  socket.on('initializeOrder', ({ orderId, deliveryPersonId, storeLocation, customerLocation }) => {
    orders.set(orderId, {
      orderId,
      deliveryPersonId,
      storeLocation,
      customerLocation,
      status: ORDER_STATUSES.IDLE,
    });
    console.log('Order initialized:', orderId);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
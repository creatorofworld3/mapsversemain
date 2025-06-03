

// const fetchRoadNetwork = async (minLat, minLon, maxLat, maxLon, retries = 3) => {
//   try {
//     const latCenter = (minLat + maxLat) / 2;
//     const lonCenter = (minLon + maxLon) / 2;
//     const radius = Math.max(10000, geolib.getDistance(
//       { latitude: minLat, longitude: minLon },
//       { latitude: maxLat, longitude: maxLon }
//     ) * 2);
//     const query = `
//       [out:json][timeout:30];
//       way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified"](around:${radius},${latCenter},${lonCenter});
//       (._;>;);
//       out body;
//     `;
//     logger.info(`Fetching road network: center=${latCenter},${lonCenter}, radius=${radius}m`);
//     const response = await axios.post('https://overpass-api.de/api/interpreter', query, {
//       timeout: 30000,
//     });
//     const elements = response.data.elements;

//     const nodes = {};
//     const ways = [];
//     elements.forEach((element) => {
//       if (element.type === 'node') {
//         nodes[element.id] = { id: element.id, lat: element.lat, lon: element.lon };
//       } else if (element.type === 'way') {
//         ways.push({ id: element.id, nodes: element.nodes, tags: element.tags || {} });
//       }
//     });

//     if (Object.keys(nodes).length === 0 || ways.length === 0) {
//       logger.warn('Empty road network');
//       if (retries > 0) {
//         logger.info(`Retrying with radius: ${radius * 1.5}m`);
//         return fetchRoadNetwork(minLat, minLon, maxLat, maxLon, retries - 1);
//       }
//       return null;
//     }

//     logger.info(`Fetched ${Object.keys(nodes).length} nodes, ${ways.length} ways`);
//     return { nodes, ways };
//   } catch (error) {
//     logger.error('Error fetching road network:', error.message);
//     if (retries > 0) {
//       logger.info(`Retrying, retries left: ${retries}`);
//       return fetchRoadNetwork(minLat, minLon, maxLat, maxLon, retries - 1);
//     }
//     return null;
//   }
// };

// const aStar = (startCoords, endCoords, nodes, ways) => {
//   const findNearestNode = (coords) => {
//     let nearestNode = null;
//     let minDistance = Infinity;
//     Object.values(nodes).forEach((node) => {
//       const distance = geolib.getDistance(
//         { latitude: coords.latitude, longitude: coords.longitude },
//         { latitude: node.lat, longitude: node.lon }
//       );
//       if (distance < minDistance && distance < 2000) {
//         minDistance = distance;
//         nearestNode = node;
//       }
//     });
//     return nearestNode;
//   };

//   logger.info(`A* start: ${JSON.stringify(startCoords)}, end: ${JSON.stringify(endCoords)}`);
//   const startNode = findNearestNode(startCoords);
//   const endNode = findNearestNode(endCoords);
//   if (!startNode || !endNode) {
//     logger.warn('No nearest node found; fallback to straight line');
//     return [startCoords, endCoords];
//   }

//   const openSet = new Set([startNode.id]);
//   const cameFrom = new Map();
//   const gScore = new Map([[startNode.id, 0]]);
//   const fScore = new Map([[startNode.id, geolib.getDistance(
//     { latitude: startNode.lat, longitude: startNode.lon },
//     { latitude: endNode.lat, longitude: endNode.lon }
//   )]]);

//   const getRoadWeight = (way) => {
//     const highway = way.tags?.highway || 'residential';
//     const weights = {
//       motorway: 0.8,
//       trunk: 0.9,
//       primary: 1.0,
//       secondary: 1.2,
//       tertiary: 1.5,
//       residential: 2.0,
//       unclassified: 2.5,
//     };
//     return weights[highway] || 2.0;
//   };

//   while (openSet.size > 0) {
//     let current = null;
//     let lowestFScore = Infinity;
//     openSet.forEach((nodeId) => {
//       if ((fScore.get(nodeId) || Infinity) < lowestFScore) {
//         lowestFScore = fScore.get(nodeId);
//         current = nodeId;
//       }
//     });

//     if (!current || !nodes[current]) {
//       logger.warn('Invalid current node; fallback to straight line');
//       return [startCoords, endCoords];
//     }

//     if (current === endNode.id) {
//       const path = [];
//       let currentNode = current;
//       let iterations = 0;
//       const maxIterations = 10000;
//       while (cameFrom.has(currentNode) && iterations < maxIterations) {
//         if (!nodes[currentNode]) {
//           logger.warn(`Invalid node ID: ${currentNode}`);
//           return [startCoords, endCoords];
//         }
//         path.push(nodes[currentNode]);
//         currentNode = cameFrom.get(currentNode);
//         iterations++;
//       }
//       if (iterations >= maxIterations) {
//         logger.warn('Path exceeded max iterations');
//         return [startCoords, endCoords];
//       }
//       if (nodes[startNode.id]) {
//         path.push(nodes[startNode.id]);
//       }
//       const route = path.reverse().map((node) => ({ latitude: node.lat, longitude: node.lon }));
//       logger.info(`Path found: ${route.length} nodes`);
//       return route;
//     }

//     openSet.delete(current);
//     const neighbors = [];
//     ways.forEach((way) => {
//       const nodeIndex = way.nodes.indexOf(Number(current));
//       if (nodeIndex >= 0) {
//         if (nodeIndex > 0 && nodes[way.nodes[nodeIndex - 1]]) {
//           neighbors.push({ id: way.nodes[nodeIndex - 1], way });
//         }
//         if (nodeIndex < way.nodes.length - 1 && nodes[way.nodes[nodeIndex + 1]]) {
//           neighbors.push({ id: way.nodes[nodeIndex + 1], way });
//         }
//       }
//     });

//     for (const { id: neighborId, way } of neighbors) {
//       if (!nodes[neighborId]) {
//         logger.warn(`Skipping invalid neighbor: ${neighborId}`);
//         continue;
//       }
//       const roadWeight = getRoadWeight(way);
//       const tentativeGScore = gScore.get(current) + (geolib.getDistance(
//         { latitude: nodes[current].lat, longitude: nodes[current].lon },
//         { latitude: nodes[neighborId].lat, longitude: nodes[neighborId].lon }
//       ) * roadWeight);

//       if (tentativeGScore < (gScore.get(neighborId) || Infinity)) {
//         cameFrom.set(neighborId, current);
//         gScore.set(neighborId, tentativeGScore);
//         fScore.set(neighborId, tentativeGScore + geolib.getDistance(
//           { latitude: nodes[neighborId].lat, longitude: nodes[neighborId].lon },
//           { latitude: endNode.lat, longitude: endNode.lon }
//         ));
//         openSet.add(neighborId);
//       }
//     }
//   }

//   logger.info('No path found; fallback to straight line');
//   return [startCoords, endCoords];
// };

// const calculateAndEmitRoute = async (orderId, deliveryCoords, customerCoords) => {
//   logger.info(`Calculating route for order ${orderId}: delivery=${JSON.stringify(deliveryCoords)}, customer=${JSON.stringify(customerCoords)}`);
//   if (!validateCoords(deliveryCoords) || !validateCoords(customerCoords)) {
//     logger.warn('Invalid coordinates');
//     io.to(orderId).emit('orderError', { message: 'Invalid coordinates for routing' });
//     return;
//   }

//   const minLat = Math.min(deliveryCoords.latitude, customerCoords.latitude) - 0.2;
//   const maxLat = Math.max(deliveryCoords.latitude, customerCoords.latitude) + 0.2;
//   const minLon = Math.min(deliveryCoords.longitude, customerCoords.longitude) - 0.2;
//   const maxLon = Math.max(deliveryCoords.longitude, customerCoords.longitude) + 0.2;

//   const roadNetwork = await fetchRoadNetwork(minLat, minLon, maxLat, maxLon);
//   let route;
//   if (!roadNetwork) {
//     logger.warn(`No road network for order ${orderId}; fallback to straight line`);
//     route = [deliveryCoords, customerCoords];
//   } else {
//     route = aStar(deliveryCoords, customerCoords, roadNetwork.nodes, roadNetwork.ways);
//   }

//   if (!Array.isArray(route) || route.length < 2 || !validateCoords(route[0]) || !validateCoords(route[route.length - 1])) {
//     logger.warn(`Invalid route for order ${orderId}; fallback`);
//     route = [deliveryCoords, customerCoords];
//   }

//   const order = orderData.get(orderId) || {};
//   orderData.set(orderId, { ...order, deliveryCoords, customerCoords, lastRoute: route, status: order.status || 'Pending' });
//   io.to(orderId).emit('routeUpdate', { orderId, route });
//   logger.info(`Route emitted for order ${orderId}: ${route.length} nodes`);
// };


  // socket.on('placeOrder', async (data) => {
  //   if (!data.orderId || !validateCoords(data.coords)) {
  //     logger.warn('Invalid place order:', data);
  //     socket.emit('orderError', { message: 'Invalid order data or coordinates' });
  //     return;
  //   }
  //   const customerCoords = { ...data.coords };
  //   const deliveryCoords = { latitude: customerCoords.latitude + 0.01, longitude: customerCoords.longitude + 0.01 };

  //   orderData.set(data.orderId, {
  //     deliveryCoords,
  //     customerCoords,
  //     lastRoute: [],
  //     status: 'Order Placed',
  //   });

  //   // await calculateAndEmitRoute(data.orderId, deliveryCoords, customerCoords);

  //   // io.to(data.orderId).emit('orderAssigned', {
  //   //   orderId: data.orderId,
  //   //   deliveryCoords,
  //   //   customerCoords,
  //   //   route: orderData.get(data.orderId).lastRoute || [],
  //   // });
  //   // io.to(data.orderId).emit('orderStatusUpdate', { orderId: data.orderId, status: 'Assigned' });
  //   // logger.info(`Order ${data.orderId} placed`);
  // });

  // socket.on('customerLocationUpdate', async (data) => {
  //   if (!data.orderId || !validateCoords(data.coords)) {
  //     logger.warn('Invalid customer location:', data);
  //     return;
  //   }
  //   logger.info(`Customer update for ${data.orderId}: ${JSON.stringify(data.coords)}`);
  //   io.to(data.orderId).emit('customerLocationUpdate', data);
  //   const order = orderData.get(data.orderId) || { lastRoute: [], status: 'Pending' };
  //   orderData.set(data.orderId, { ...order, customerCoords: data.coords });
  //   if (order.deliveryCoords && geolib.getDistance(data.coords, order.customerCoords || data.coords) >= 50) {
  //     await calculateAndEmitRoute(data.orderId, order.deliveryCoords, data.coords);
  //   }
  // });

  // socket.on('deliveryLocationUpdate', async (data) => {
  //   if (!data.orderId || !validateCoords(data.coords)) {
  //     logger.warn('Invalid delivery location:', data);
  //     return;
  //   }
  //   logger.info(`Delivery update for ${data.orderId}: ${JSON.stringify(data.coords)}`);
  //   io.to(data.orderId).emit('deliveryLocationUpdate', data);
  //   const order = orderData.get(data.orderId) || { lastRoute: [], status: 'Pending' };
  //   orderData.set(data.orderId, { ...order, deliveryCoords: data.coords });
  //   if (order.customerCoords && geolib.getDistance(data.coords, order.deliveryCoords || data.coords) >= 50) {
  //     await calculateAndEmitRoute(data.orderId, data.coords, order.customerCoords);
  //   }
  // });

  // socket.on('orderStatusUpdate', (data) => {
  //   if (!data.orderId || !data.status || typeof data.status !== 'string') {
  //     logger.warn('Invalid order status:', data);
  //     return;
  //   }
  //   logger.info(`Status update for ${data.orderId}: ${data.status}`);
  //   const order = orderData.get(data.orderId) || { lastRoute: [] };
  //   orderData.set(data.orderId, { ...order, status: data.status });
  //   io.to(data.orderId).emit('orderStatusUpdate', data);
  //   if (data.status === 'Delivered') {
  //     orderData.delete(data.orderId);
  //     logger.info(`Order ${data.orderId} has been delivered and removed from orderData`);
  //   }
  // });
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Store connected clients
const connectedClients = {
  delivery: null,
  customer: null
};

// Store coordinates
let deliveryCoords = null;
let customerCoords = null;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log' }),
  ],
});

const limiter = rateLimit({
  windowMs: 1000,
  max: 10,
});

app.use(limiter);
app.use(compression());

const validateCoords = (coords) => {
  if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
    logger.warn('Invalid coordinates:', coords);
    return false;
  }
  return coords.latitude >= -90 && coords.latitude <= 90 && coords.longitude >= -180 && coords.longitude <= 180;
};

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Handle delivery person connection
  socket.on('joinAsDelivery', () => {
    connectedClients.delivery = socket.id;
    socket.join('delivery');
    logger.info(`Delivery person joined: ${socket.id}`);
    socket.emit('joinedAsDelivery', { success: true });
  });

  // Handle customer connection
  socket.on('joinAsCustomer', () => {
    connectedClients.customer = socket.id;
    socket.join('customer');
    logger.info(`Customer joined: ${socket.id}`);
    socket.emit('joinedAsCustomer', { success: true });
  });

  // Handle delivery location updates
  socket.on('deliveryLocation', (data) => {
    if (!validateCoords(data.deliveryCoords)) {
      socket.emit('error', { message: 'Invalid delivery coordinates' });
      return;
    }
    
    deliveryCoords = data.deliveryCoords;
    logger.info('Delivery location updated:', deliveryCoords);
    
    // Send to customer
    socket.to('customer').emit('deliveryLocation', deliveryCoords);
    
    // Try to connect if both coordinates are available
    tryConnect();
  });

  // Handle customer location updates
  socket.on('customerLocation', (data) => {
    if (!validateCoords(data.customerCoords)) {
      socket.emit('error', { message: 'Invalid customer coordinates' });
      return;
    }
    
    customerCoords = data.customerCoords;
    logger.info('Customer location updated:', customerCoords);
    
    // Send to delivery
    socket.to('delivery').emit('customerLocation', customerCoords);
    
    // Try to connect if both coordinates are available
    tryConnect();
  });

  // Try to establish connection between delivery and customer
  const tryConnect = async () => {
    if (deliveryCoords && customerCoords && connectedClients.delivery && connectedClients.customer) {
      try {
        logger.info('Attempting to connect delivery and customer with route calculation');
        // Fetch route from OpenRouteService
        const response = await axios.post(
          'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
          {
            coordinates: [
              [deliveryCoords.longitude, deliveryCoords.latitude],
              [customerCoords.longitude, customerCoords.latitude]
            ],
            instructions: false
          },
          {
            headers: {
              'Authorization': 'Bearer 5b3ce3597851110001cf62486d2c2c7b8ea443aeb5611f95c23fbdd5',
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
        // Calculate estimated time (rough calculation)

        // Emit connection success to both clients
        io.emit('connected', { 
          deliveryCoords, 
          customerCoords, 
          routeCoords,
          orderStatus: 'In Transit'
        });

        logger.info('Successfully connected delivery and customer');
      } catch (error) {
        logger.error('Failed to fetch route:', error.message);
        io.emit('error', { message: `Failed to establish connection: ${error.message}` });
      }
    }
  };

  // Handle order status updates
  socket.on('updateOrderStatus', (data) => {
    const { status, eta } = data;
    io.emit('orderStatusUpdate', { status, eta });
    logger.info(`Order status updated: ${status}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
    
    // Clean up connected clients
    if (connectedClients.delivery === socket.id) {
      connectedClients.delivery = null;
      deliveryCoords = null;
      logger.info('Delivery person disconnected');
    }
    
    if (connectedClients.customer === socket.id) {
      connectedClients.customer = null;
      customerCoords = null;
      logger.info('Customer disconnected');
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
    // const order = orderData.get(orderId);
    // if (order) {
    //   socket.emit('orderAssigned', {
    //     orderId,
    //     deliveryCoords: order.deliveryCoords,
    //     customerCoords: order.customerCoords,
    //     route: order.lastRoute || [],
    //   });
    //   socket.emit('orderStatusUpdate', { orderId, status: order.status || 'Assigned' });
    // }
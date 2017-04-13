import 'mocha';

import {
  assert,
  expect,
} from 'chai';

import * as sinon from 'sinon';

import * as WebSocket from 'ws';

Object.assign(global, {
  WebSocket: WebSocket,
});

import {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';

import {
  PubSub,
  SubscriptionManager,
} from 'graphql-subscriptions';

import MessageTypes from '../common/message-types';

import { GRAPHQL_WS } from '../common/protocol';

import * as http from 'http';

import {
  GraphQLTransportWSServer,
  SubscribeMessage,
} from '../server';

import { GraphQLTransportWSClient } from '../client';

import { SubscriptionOptions } from 'graphql-subscriptions/dist/pubsub';

const TEST_PORT = 4953;
const KEEP_ALIVE_TEST_PORT = TEST_PORT + 1;
const DELAYED_TEST_PORT = TEST_PORT + 2;
const RAW_TEST_PORT = TEST_PORT + 4;
const EVENTS_TEST_PORT = TEST_PORT + 5;
const ONCONNECT_ERROR_TEST_PORT = TEST_PORT + 6;

const data: {[key: string]: {[key: string]: string}} = {
  '1': {
    'id': '1',
    'name': 'Dan',
  },
  '2': {
    'id': '2',
    'name': 'Marie',
  },
  '3': {
    'id': '3',
    'name': 'Jessie',
  },
};

const userType = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: {type: GraphQLString},
    name: {type: GraphQLString},
  },
});

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Query',
    fields: {
      testString: {type: GraphQLString},
    },
  }),
  subscription: new GraphQLObjectType({
    name: 'Subscription',
    fields: {
      user: {
        type: userType,
        // `args` describes the arguments that the `user` query accepts
        args: {
          id: {type: GraphQLString},
        },
        // The resolve function describes how to 'resolve' or fulfill
        // the incoming query.
        // In this case we use the `id` argument from above as a key
        // to get the User from `data`
        resolve: function (_, {id}) {
          return data[id];
        },
      },
      userFiltered: {
        type: userType,
        args: {
          id: {type: GraphQLString},
        },
        resolve: function (_, {id}) {
          return data[id];
        },
      },
      context: {
        type: GraphQLString,
        resolve: (root, args, ctx) => {
          return ctx;
        },
      },
      error: {
        type: GraphQLString, resolve: () => {
          throw new Error('E1');
        },
      },
    },
  }),
});

const subscriptionManager = new SubscriptionManager({
  schema,
  pubsub: new PubSub(),
  setupFunctions: {
    'userFiltered': (options: SubscriptionOptions, args: {[key: string]: any}) => ({
      'userFiltered': {
        filter: (user: any) => {
          return !args['id'] || user.id === args['id'];
        },
      },
    }),
  },
});

// indirect call to support spying
const handlers = {
  onSubscribe: (msg: SubscribeMessage, params: SubscriptionOptions, webSocketRequest: WebSocket) => {
    return Promise.resolve(Object.assign({}, params, {context: msg['context']}));
  },
};

const options = {
  subscriptionManager,
  onSubscribe: (msg: SubscribeMessage, params: SubscriptionOptions, webSocketRequest: WebSocket) => {
    return handlers.onSubscribe(msg, params, webSocketRequest);
  },
};

const eventsOptions = {
  subscriptionManager,
  onSubscribe: sinon.spy((msg: SubscribeMessage, params: SubscriptionOptions, webSocketRequest: WebSocket) => {
    return Promise.resolve(Object.assign({}, params, {context: msg['context']}));
  }),
  onUnsubscribe: sinon.spy(),
  onConnect: sinon.spy(() => {
    return {test: 'test context'};
  }),
  onDisconnect: sinon.spy(),
};

const onConnectErrorOptions = {
  subscriptionManager,
  onConnect: () => {
    throw new Error('Error');
  },
};

function notFoundRequestListener(request: http.IncomingMessage, response: http.ServerResponse) {
  response.writeHead(404);
  response.end();
}

const httpServer = http.createServer(notFoundRequestListener);
httpServer.listen(TEST_PORT);
new GraphQLTransportWSServer(options, {server: httpServer});

const httpServerWithKA = http.createServer(notFoundRequestListener);
httpServerWithKA.listen(KEEP_ALIVE_TEST_PORT);
new GraphQLTransportWSServer(Object.assign({}, options, {keepAlive: 10}), {server: httpServerWithKA});

const httpServerWithEvents = http.createServer(notFoundRequestListener);
httpServerWithEvents.listen(EVENTS_TEST_PORT);
const eventsServer = new GraphQLTransportWSServer(eventsOptions, {server: httpServerWithEvents});

const httpServerWithOnConnectError = http.createServer(notFoundRequestListener);
httpServerWithOnConnectError.listen(ONCONNECT_ERROR_TEST_PORT);
new GraphQLTransportWSServer(onConnectErrorOptions, {server: httpServerWithOnConnectError});

const httpServerWithDelay = http.createServer(notFoundRequestListener);
httpServerWithDelay.listen(DELAYED_TEST_PORT);
new GraphQLTransportWSServer(Object.assign({}, options, {
  onSubscribe: (msg: SubscribeMessage, params: SubscriptionOptions) => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve(Object.assign({}, params, {context: msg['context']}));
      }, 100);
    });
  },
}), {server: httpServerWithDelay});

const httpServerRaw = http.createServer(notFoundRequestListener);
httpServerRaw.listen(RAW_TEST_PORT);

export {
  assert,
  expect,
  sinon,
  WebSocket,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  PubSub,
  SubscriptionManager,
  MessageTypes,
  GRAPHQL_WS,
  GraphQLTransportWSServer,
  GraphQLTransportWSClient,
  SubscribeMessage,
  SubscriptionOptions,
  TEST_PORT,
  KEEP_ALIVE_TEST_PORT,
  DELAYED_TEST_PORT,
  RAW_TEST_PORT,
  EVENTS_TEST_PORT,
  ONCONNECT_ERROR_TEST_PORT,
  data,
  userType,
  schema,
  subscriptionManager,
  handlers,
  options,
  eventsOptions,
  onConnectErrorOptions,
  eventsServer,
  httpServerRaw,
  httpServer,
};

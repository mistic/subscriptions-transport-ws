import * as WebSocket from 'ws';

import MessageTypes from './message-types';
import { GRAPHQL_WS, GRAPHQL_SUBSCRIPTIONS } from './protocol';
import { SubscriptionManager } from 'graphql-subscriptions';
import isObject = require('lodash.isobject');
import { getOperationAST, print, parse, ExecutionResult, GraphQLSchema, DocumentNode } from 'graphql';

export interface IObservableSubscription {
  unsubscribe: () => void;
}
export interface IObservable<T> {
  subscribe(observer: {
    next?: (v: T) => void;
    error?: (e: Error) => void;
    complete?: () => void
  }): IObservableSubscription;
}

type ConnectionContext = {
  initPromise?: Promise<any>,
  isLegacy: boolean,
  socket: WebSocket,
  requests: {
    [reqId: string]: IObservableSubscription;
  },
};

export interface RequestMessage {
  payload?: {
    [key: string]: any; // this will support for example any options sent in init like the auth token
    query?: string;
    variables?: {[key: string]: any};
    operationName?: string;
  };
  id?: string;
  type: string;
}

export type ExecuteReactiveFunction = (
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: any,
  contextValue?: any,
  variableValues?: {[key: string]: any},
  operationName?: string,
) => IObservable<ExecutionResult>;

export type ExecuteFunction = (
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: any,
  contextValue?: any,
  variableValues?: {[key: string]: any},
  operationName?: string,
) => Promise<ExecutionResult>;

export interface Executor {
  execute?: ExecuteFunction;
  executeReactive?: ExecuteReactiveFunction;
}

export interface ServerOptions {
  rootValue?: any;
  schema?: GraphQLSchema;
  executor?: Executor;
  /**
   * @deprecated subscriptionManager is deprecated, use executor instead
   */
  subscriptionManager?: SubscriptionManager;
  /**
   * @deprecated onSubscribe is deprecated, use onRequest instead
   */
  onSubscribe?: Function;
  /**
   * @deprecated onUnsubscribe is deprecated, use onRequestComplete instead
   */
  onUnsubscribe?: Function;
  onRequest?: Function;
  onRequestComplete?: Function;
  onConnect?: Function;
  onDisconnect?: Function;
  keepAlive?: number;
  // contextValue?: any;
  // rootValue?: any;
  // formatResponse?: (Object) => Object;
  // validationRules?: Array<any>;
  // triggerGenerator?: (name: string, args: Object, context?: Object) => Array<{name: string, filter: Function}>;
}

export class SubscriptionServer {
  /**
   * @deprecated onSubscribe is deprecated, use onRequest instead
   */
  private onSubscribe: Function;
  /**
   * @deprecated onUnsubscribe is deprecated, use onRequestComplete instead
   */
  private onUnsubscribe: Function;
  private onRequest: Function;
  private onRequestComplete: Function;
  private onConnect: Function;
  private onDisconnect: Function;
  private wsServer: WebSocket.Server;
  private execute: ExecuteReactiveFunction;
  private schema: GraphQLSchema;
  private rootValue: any;

  public static create(options: ServerOptions, socketOptions: WebSocket.IServerOptions) {
    return new SubscriptionServer(options, socketOptions);
  }

  // TODO: All of the adapters should actually live inside static class
  private executeFromExecute(execute: ExecuteFunction): ExecuteReactiveFunction {
    return (schema: GraphQLSchema,
            document: DocumentNode,
            rootValue?: any,
            contextValue?: any,
            variableValues?: {[key: string]: any},
            operationName?: string,
      ) => ({
        subscribe: (observer) => {
          // TODO: if subscription call observer.error with not supported.
          // if (isSubscription && this.executor.execute) {
          //    return new Promise((reject) => {
          //      reject(`You can't use subscriptions with execute function.`);
          //    });

          execute(schema, document, rootValue, contextValue, variableValues, operationName)
            .then((result: ExecutionResult) => {
              observer.next(result);
              observer.complete();
            },
            (e) => observer.error(e));

            return {
              unsubscribe: () => { /* Promises cannot be canceled */ },
            };
          },
      });
  }

  private executeFromSubscriptionManager(subscriptionManager: SubscriptionManager): ExecuteReactiveFunction {
    return (schema: GraphQLSchema,
            document: DocumentNode,
            rootValue?: any,
            contextValue?: any,
            variableValues?: {[key: string]: any},
            operationName?: string,
      ) => ({
        subscribe: (observer) => {
          // TODO: if query / mutation call observer.error with not supported.
          //
          // } else if (!isSubscription && this.subscriptionManager) {
          //   return new Promise((reject) => {
          //     reject(`You can't use queries/mutations with old subscriptionManager function.`);
          //   });
          // }

          const callback = (error: Error | { errors: [ Error ] }, v: ExecutionResult) => {
            if (error) {
              if ( error.hasOwnProperty('errors') ) {
                // ValidationError
                return observer.next({ errors: (error as any).errors });
              } else {
                return observer.error(error as Error);
              }
            }

            observer.next(v);
          }

          const subIdPromise = subscriptionManager.subscribe({
            // Yeah, subscriptionManager needs it printed for some reason...
            query: print(document),
            operationName,
            callback,
            variables: variableValues,
            context: contextValue,
          }).then(undefined, (e: Error) => observer.error(e));

          return {
            unsubscribe: () => {
              subIdPromise.then((reqId: number) => {
                if ( undefined !== reqId ) {
                  subscriptionManager.unsubscribe(reqId);
                }
              });
            },
          };
        },
    });
  };

  private loadExecutor(options: ServerOptions) {
    const {subscriptionManager, executor, schema, rootValue} = options;

    if (!subscriptionManager || !executor) {
      throw new Error('Must provide `subscriptionManager` or `executor` to websocket server constructor.');
    }

    if (subscriptionManager && executor) {
      throw new Error('Must provide `subscriptionManager` or `executor` and not both.');
    }

    if (executor && !executor.execute && !executor.executeReactive) {
      throw new Error('Must define at least execute or executeReactive function');
    }

    if (executor && !schema) {
      throw new Error('Must provide `schema` when using `executor`.');
    }

    if (subscriptionManager) {
      console.warn('subscriptionManager is deprecated, use GraphQLExecutorWithSubscriptions executor instead.');
    }

    this.schema = schema;
    this.rootValue = rootValue;
    if ( subscriptionManager ) {
      this.execute = this.executeFromSubscriptionManager(subscriptionManager);
    } else if ( executor.executeReactive ) {
      this.execute = executor.executeReactive.bind(executor);
    } else {
      this.execute = this.executeFromExecute(executor.execute.bind(executor));
    }
  }

  constructor(options: ServerOptions, socketOptions: WebSocket.IServerOptions) {
    const {onSubscribe, onUnsubscribe, onRequest,
      onRequestComplete, onConnect, onDisconnect, keepAlive} = options;

    this.loadExecutor(options);
    this.onSubscribe = this.defineDeprecateFunctionWrapper('onSubscribe function is deprecated. ' +
      'Use onRequest instead.');
    this.onUnsubscribe = this.defineDeprecateFunctionWrapper('onUnsubscribe function is deprecated. ' +
      'Use onRequestComplete instead.');
    this.onRequest = onSubscribe ? onSubscribe : onRequest;
    this.onRequestComplete = onUnsubscribe ? onUnsubscribe : onRequestComplete;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;

    // Init and connect websocket server to http
    this.wsServer = new WebSocket.Server(socketOptions || {});

    this.wsServer.on('connection', (socket: WebSocket) => {
      // NOTE: the old GRAPHQL_SUBSCRIPTIONS protocol support should be removed in the future
      if (socket.protocol === undefined ||
        (socket.protocol.indexOf(GRAPHQL_WS) === -1 && socket.protocol.indexOf(GRAPHQL_SUBSCRIPTIONS) === -1)) {
        // Close the connection with an error code, and
        // then terminates the actual network connection (sends FIN packet)
        // 1002: protocol error
        socket.close(1002);
        socket.terminate();

        return;
      }

      const connectionContext: ConnectionContext = Object.create(null);
      connectionContext.isLegacy = false;
      connectionContext.socket = socket;
      connectionContext.requests = {};

      // Regular keep alive messages if keepAlive is set
      if (keepAlive) {
        const keepAliveTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            this.sendMessage(connectionContext, undefined, MessageTypes.GQL_CONNECTION_KEEP_ALIVE, undefined);
          } else {
            clearInterval(keepAliveTimer);
          }
        }, keepAlive);
      }

      socket.on('message', this.onMessage(connectionContext));
      socket.on('close', () => {
        this.onClose(connectionContext);

        if (this.onDisconnect) {
          this.onDisconnect(socket);
        }
      });
    });
  }

  private unsubscribe(connectionContext: ConnectionContext, reqId: string) {
    if (connectionContext.requests && connectionContext.requests[reqId]) {
      connectionContext.requests[reqId].unsubscribe();
      delete connectionContext.requests[reqId];
    }

    if (this.onRequestComplete) {
      this.onRequestComplete(connectionContext.socket);
    }
  }

  private onClose(connectionContext: ConnectionContext) {
    Object.keys(connectionContext.requests).forEach((reqId) => {
      this.unsubscribe(connectionContext, reqId);
    });
  }

  private onMessage(connectionContext: ConnectionContext) {
    let onInitResolve: any = null, onInitReject: any = null;

    connectionContext.initPromise = new Promise((resolve, reject) => {
      onInitResolve = resolve;
      onInitReject = reject;
    });

    return (message: any) => {
      let parsedMessage: RequestMessage;
      try {
        parsedMessage = this.parseLegacyProtocolMessage(connectionContext, JSON.parse(message));
      } catch (e) {
        this.sendError(connectionContext, null, { message: e.message }, MessageTypes.GQL_CONNECTION_ERROR);
        return;
      }

      const reqId = parsedMessage.id;
      switch (parsedMessage.type) {
        case MessageTypes.GQL_CONNECTION_INIT:
          let onConnectPromise = Promise.resolve(true);
          if (this.onConnect) {
            onConnectPromise = new Promise((resolve, reject) => {
              try {
                resolve(this.onConnect(parsedMessage.payload, connectionContext));
              } catch (e) {
                reject(e);
              }
            });
          }

          onInitResolve(onConnectPromise);

          connectionContext.initPromise.then((result) => {
            if (result === false) {
              throw new Error('Prohibited connection!');
            }

            this.sendMessage(
              connectionContext,
              undefined,
              MessageTypes.GQL_CONNECTION_ACK,
              undefined,
            );
          }).catch((error: Error) => {
            this.sendError(
              connectionContext,
              reqId,
              { message: error.message },
              MessageTypes.GQL_CONNECTION_ERROR,
            );

            // Close the connection with an error code, and
            // then terminates the actual network connection (sends FIN packet)
            // 1011: an unexpected condition prevented the request from being fulfilled
            // We are using setTimeout because we want the message to be flushed before
            // disconnecting the client
            setTimeout(() => {
              connectionContext.socket.close(1011);
              connectionContext.socket.terminate();
            }, 10);

          });
          break;

        case MessageTypes.GQL_CONNECTION_TERMINATE:
          connectionContext.socket.close();
          connectionContext.socket.terminate();
          break;

        case MessageTypes.GQL_START:
          connectionContext.initPromise.then((initResult) => {
            const baseParams = {
              query: parsedMessage.payload.query,
              variables: parsedMessage.payload.variables,
              operationName: parsedMessage.payload.operationName,
              context: Object.assign({}, isObject(initResult) ? initResult : {}),
              formatResponse: <any>undefined,
              formatError: <any>undefined,
              callback: <any>undefined,
            };
            let promisedParams = Promise.resolve(baseParams);

            if (this.onRequest) {
              promisedParams = Promise.resolve(this.onRequest(parsedMessage, baseParams, connectionContext.socket));
            }

            // if we already have a subscription with this id, unsubscribe from it first
            this.unsubscribe(connectionContext, reqId);

            promisedParams.then((params: any) => {
              if (typeof params !== 'object') {
                const error = `Invalid params returned from onRequest! return values must be an object!`;
                this.sendError(connectionContext, reqId, { message: error });

                throw new Error(error);
              }

              return this.execute(this.schema,
                parse(baseParams.query),
                this.rootValue,
                baseParams.context,
                baseParams.variables,
                baseParams.operationName)
              .subscribe({
                  next: (v: ExecutionResult) => {
                    // TODO: Handle formatResponse;
                    this.sendMessage(connectionContext, reqId, MessageTypes.GQL_DATA, v);
                  },
                  error: (e: Error) => {
                    // TODO: handle formatError
                    this.sendMessage(connectionContext, reqId, MessageTypes.GQL_ERROR, e);
                  },
                  complete: () => this.sendMessage(connectionContext, reqId, MessageTypes.GQL_COMPLETE, null),
                });
            }).then((subscription: IObservableSubscription) => {
              connectionContext.requests[reqId] = subscription;
            }).then(() => {
              // NOTE: This is a temporary code to support the legacy protocol.
              // As soon as the old protocol has been removed, this coode should also be removed.
              this.sendMessage(connectionContext, reqId, MessageTypes.SUBSCRIPTION_SUCCESS, undefined);
            }).catch((e: any) => {
              if (e.errors) {
                this.sendMessage(connectionContext, reqId, MessageTypes.GQL_DATA, { errors: e.errors });
              } else {
                this.sendError(connectionContext, reqId, { message: e.message });
              }

              // Remove the request on the server side as it will be removed also in the client
              this.unsubscribe(connectionContext, reqId);
              return;
            });
          });
          break;

        case MessageTypes.GQL_END:
          connectionContext.initPromise.then(() => {
            // Find subscription id. Call unsubscribe.
            this.unsubscribe(connectionContext, reqId);
          });
          break;

        default:
          this.sendError(connectionContext, reqId, { message: 'Invalid message type!' });
      }
    };
  }

  // NOTE: The old protocol support should be removed in the future
  private parseLegacyProtocolMessage(connectionContext: ConnectionContext, message: any) {
    let messageToReturn = message;

    switch (message.type) {
      case MessageTypes.INIT:
        connectionContext.isLegacy = true;
        messageToReturn = { ...message, type: MessageTypes.GQL_CONNECTION_INIT };
        break;
      case MessageTypes.SUBSCRIPTION_START:
        messageToReturn = {
          id: message.id,
          type: MessageTypes.GQL_START,
          payload: {
            query: message.query,
            operationName: message.operationName,
            variables: message.variables,
          },
        };
        break;
      case MessageTypes.SUBSCRIPTION_END:
        messageToReturn = { ...message, type: MessageTypes.GQL_END };
        break;
      case MessageTypes.GQL_CONNECTION_ACK:
        if (connectionContext.isLegacy) {
          messageToReturn = {...message, type: MessageTypes.INIT_SUCCESS};
        }
        break;
      case MessageTypes.GQL_CONNECTION_ERROR:
        if (connectionContext.isLegacy) {
          messageToReturn = {...message, type: MessageTypes.INIT_FAIL};
        }
        break;
      case MessageTypes.GQL_ERROR:
        if (connectionContext.isLegacy) {
          messageToReturn = {...message, type: MessageTypes.SUBSCRIPTION_FAIL};
        }
        break;
      case MessageTypes.GQL_DATA:
        if (connectionContext.isLegacy) {
          messageToReturn = {...message, type: MessageTypes.SUBSCRIPTION_DATA};
        }
        break;
      case MessageTypes.GQL_COMPLETE:
        if (connectionContext.isLegacy) {
          messageToReturn = null;
        }
        break;
      case MessageTypes.SUBSCRIPTION_SUCCESS:
        if (!connectionContext.isLegacy) {
          messageToReturn = null;
        }
        break;
      default:
        break;
    }

    return messageToReturn;
  };

  // NOTE: This is temporary and should be removed as soon as SubscriptionsManager
  // implements the complete function of the observable
  private isASubscriptionRequest(query: any, operationName: string): boolean {
    const document = parse(query);
    const operationAST = getOperationAST(document, operationName);

    return !!operationAST && operationAST.operation === 'subscription';
  }

  private sendMessage(connectionContext: ConnectionContext, reqId: string, type: string, payload: any): void {
    const parsedMessage = this.parseLegacyProtocolMessage(connectionContext, {
      type,
      id: reqId,
      payload,
    });

    if (parsedMessage) {
      connectionContext.socket.send(JSON.stringify(parsedMessage));
    }
  }

  private sendError(connectionContext: ConnectionContext, reqId: string, errorPayload: any,
                           overrideDefaultErrorType?: string): void {
    if ([
        MessageTypes.GQL_CONNECTION_ERROR,
        MessageTypes.GQL_ERROR,
      ].indexOf(overrideDefaultErrorType) === -1) {
      throw new Error('overrideDefaultErrorType should be one of the allowed error messages' +
        ' GQL_CONNECTION_ERROR or GQL_ERROR');
    }

    this.sendMessage(
      connectionContext,
      reqId,
      overrideDefaultErrorType || MessageTypes.GQL_ERROR,
      errorPayload,
    );
  }

  private defineDeprecateFunctionWrapper(deprecateMessage: string) {
    return () => {
      console.warn(deprecateMessage);
    };
  }
}

import {
  WebSocket,
  httpServerRaw,
  expect,
  assert,
  subscriptionManager,
  RAW_TEST_PORT,
  TEST_PORT,
  DELAYED_TEST_PORT,
  GraphQLTransportWSClient,
  MessageTypes,
} from '../config';

describe('Client', function () {
  let wsServer: WebSocket.Server;

  beforeEach(() => {
    wsServer = new WebSocket.Server({
      server: httpServerRaw,
    });
  });

  afterEach(() => {
    if (wsServer) {
      wsServer.close();
    }
  });

  it('should send INIT message when creating the connection', (done) => {
    wsServer.on('connection', (connection: any) => {
      connection.on('message', (message: any) => {
        const parsedMessage = JSON.parse(message);
        expect(parsedMessage.type).to.equals('connection_init');
        done();
      });
    });

    new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`);
  });

  it('should send INIT message first, then the SUBSCRIPTION_START message', (done) => {
    let initReceived = false;

    const client = new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`);
    wsServer.on('connection', (connection: any) => {
      connection.on('message', (message: any) => {
        const parsedMessage = JSON.parse(message);
        // mock server
        if (parsedMessage.type === MessageTypes.GQL_CONNECTION_INIT) {
          connection.send(JSON.stringify({type: MessageTypes.GQL_CONNECTION_ACK, payload: {}}));
          initReceived = true;
        }
        if (parsedMessage.type === MessageTypes.GQL_SUBSCRIPTION_START) {
          expect(initReceived).to.be.true;
          client.unsubscribeAll();
          done();
        }
      });
    });
    client.subscribe(
      {
        query: `subscription useInfo {
          user(id: 3) {
            id
            name
          }
        }`,
      },
      (error, result) => {
        // do nothing
      }
    );
  });

  it('should emit connect event for client side when socket is open', (done) => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    const unregister = client.onConnect(() => {
      unregister();
      done();
    });
  });

  it('should emit disconnect event for client side when socket closed', (done) => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`, {
      connectionCallback: () => {
        client.client.close();
      },
    });

    const unregister = client.onDisconnect(() => {
      unregister();
      done();
    });
  });

  it('should emit reconnect event for client side when socket closed', (done) => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`, {
      reconnect: true,
      reconnectionAttempts: 1,
      connectionCallback: () => {
        client.client.close();
      },
    });

    const unregister = client.onReconnect(() => {
      unregister();
      done();
    });
  });

  it('should throw an exception when query is not provided', () => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    expect(() => {
      client.subscribe({
          query: undefined,
          operationName: 'useInfo',
          variables: {
            id: 3,
          },
        }, function (error: any, result: any) {
          //do nothing
        }
      );
    }).to.throw();
  });

  it('should throw an exception when query is not valid', () => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    expect(() => {
      client.subscribe({
          query: <string>{},
          operationName: 'useInfo',
          variables: {
            id: 3,
          },
        }, function (error: any, result: any) {
          //do nothing
        }
      );
    }).to.throw();
  });

  it('should throw an exception when handler is not provided', () => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    expect(() => {
      client.subscribe({
          query: `subscription useInfo($id: String) {
            user(id: $id) {
              id
              name
            }
          }`,
        },
        undefined
      );
    }).to.throw();
  });

  it('should allow both data and errors on SUBSCRIPTION_DATA', (done) => {
    wsServer.on('connection', (connection: any) => {
      connection.on('message', (message: any) => {
        const parsedMessage = JSON.parse(message);
        // mock server
        if (parsedMessage.type === MessageTypes.GQL_CONNECTION_INIT) {
          connection.send(JSON.stringify({type: MessageTypes.GQL_CONNECTION_ACK, payload: {}}));
        }
        if (parsedMessage.type === MessageTypes.GQL_SUBSCRIPTION_START) {
          connection.send(JSON.stringify({type: MessageTypes.GQL_SUBSCRIPTION_SUCCESS, id: parsedMessage.id}), () => {
            const dataMessage = {
              type: MessageTypes.GQL_SUBSCRIPTION_DATA,
              id: parsedMessage.id,
              payload: {
                data: {
                  some: 'data',
                },
                errors: [{
                  message: 'Test Error',
                }],
              },
            };
            connection.send(JSON.stringify(dataMessage));
          });
        }
      });
    });

    const client = new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`);

    client.subscribe(
      {
        query: `subscription useInfo($id: String) {
          user(id: $id) {
            id
            name
          }
        }`,
        operationName: 'useInfo',
        variables: {
          id: 3,
        },
      },
      (error, result) => {
        expect(result).to.have.property('some');
        expect(error).to.be.lengthOf(1);
        done();
      }
    );
  });

  it('should send connectionParams along with init message', (done) => {
    const connectionParams: any = {
      test: true,
    };
    wsServer.on('connection', (connection: any) => {
      connection.on('message', (message: any) => {
        const parsedMessage = JSON.parse(message);
        expect(JSON.stringify(parsedMessage.payload)).to.equal(JSON.stringify(connectionParams));
        done();
      });
    });

    new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`, {
      connectionParams: connectionParams,
    });
  });

  it('should handle correctly init_fail message', (done) => {
    wsServer.on('connection', (connection: any) => {
      connection.on('message', (message: any) => {
        connection.send(JSON.stringify({type: 'connection_error', payload: {error: 'test error'}}));
      });
    });

    new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`, {
      connectionCallback: (error: any) => {
        expect(error).to.equals('test error');
        done();
      },
    });
  });

  it('should handle init_fail message and handle server that closes connection', (done) => {
    let client: any = null;

    wsServer.on('connection', (connection: any) => {
      connection.on('message', (message: any) => {
        connection.send(JSON.stringify({type: 'init_fail', payload: {error: 'test error'}}), () => {
          connection.close();
          connection.terminate();

          setTimeout(() => {
            expect(client.client.readyState).to.equals(WebSocket.CLOSED);
            done();
          }, 500);
        });
      });
    });

    client = new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`);
  });

  it('should handle correctly init_success message', (done) => {
    wsServer.on('connection', (connection: any) => {
      connection.on('message', (message: any) => {
        connection.send(JSON.stringify({type: 'connection_ack'}));
      });
    });

    new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`, {
      connectionCallback: (error: any) => {
        expect(error).to.equals(undefined);
        done();
      },
    });
  });

  it('removes subscription when it unsubscribes from it', function () {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    setTimeout(() => {
      let subId = client.subscribe({
          query: `subscription useInfo($id: String) {
          user(id: $id) {
            id
            name
          }
        }`,
          operationName: 'useInfo',
          variables: {
            id: 3,
          },
        }, function (error: any, result: any) {
          //do nothing
        }
      );
      client.unsubscribe(subId);
      assert.notProperty(client.requests, `${subId}`);
    }, 100);
  });

  it('queues messages while websocket is still connecting', function () {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    let subId = client.subscribe({
        query: `subscription useInfo($id: String) {
        user(id: $id) {
          id
          name
        }
      }`,
        operationName: 'useInfo',
        variables: {
          id: 3,
        },
      }, function (error: any, result: any) {
        //do nothing
      }
    );
    expect((client as any).unsentMessagesQueue.length).to.equals(1);
    client.unsubscribe(subId);
    expect((client as any).unsentMessagesQueue.length).to.equals(2);
    setTimeout(() => {
      expect((client as any).unsentMessagesQueue.length).to.equals(0);
    }, 100);
  });

  it('should call error handler when graphql result has errors', function (done) {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    setTimeout(() => {
      client.subscribe({
          query: `subscription useInfo{
          error
        }`,
          variables: {},
        }, function (error: any, result: any) {
          if (error) {
            client.unsubscribeAll();
            done();
          }
          if (result) {
            client.unsubscribeAll();
            assert(false);
          }
        }
      );
    }, 100);
    setTimeout(() => {
      subscriptionManager.publish('error', {});
    }, 200);
  });

  it('should call error handler when graphql query is not valid', function (done) {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    setTimeout(() => {
      client.subscribe({
          query: `subscription useInfo{
          invalid
        }`,
          variables: {},
        }, function (error: Error[], result: any) {
          if (error) {
            expect(error[0].message).to.equals('Cannot query field "invalid" on type "Subscription".');
            done();
          } else {
            assert(false);
          }
        }
      );
    }, 100);
  });

  function testBadServer(payload: any, errorMessage: string, done: Function) {
    wsServer.on('connection', (connection: WebSocket) => {
      connection.on('message', (message: any) => {
        const parsedMessage = JSON.parse(message);
        if (parsedMessage.type === MessageTypes.GQL_SUBSCRIPTION_START) {
          connection.send(JSON.stringify({
            type: MessageTypes.GQL_SUBSCRIPTION_FAIL,
            id: parsedMessage.id,
            payload,
          }));
        }
      });
    });

    const client = new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`);
    client.subscribe({
      query: `
        subscription useInfo{
          invalid
        }
      `,
      variables: {},
    }, function (errors: Error[], result: any) {
      if (errors) {
        expect(errors[0].message).to.equals(errorMessage);
      } else {
        assert(false);
      }
      done();
    });
  }

  it('should handle missing errors', function (done) {
    const errorMessage = 'Unknown error';
    const payload = {};
    testBadServer(payload, errorMessage, done);
  });

  it('should handle errors that are not an array', function (done) {
    const errorMessage = 'Just an error';
    const payload = {
      errors: {message: errorMessage},
    };
    testBadServer(payload, errorMessage, done);
  });

  it('should throw an error when the susbcription times out', function (done) {
    // hopefully 1ms is fast enough to time out before the server responds
    const client = new GraphQLTransportWSClient(`ws://localhost:${DELAYED_TEST_PORT}/`, {timeout: 1});

    setTimeout(() => {
      client.subscribe({
        query: `subscription useInfo{
            error
          }`,
        operationName: 'useInfo',
        variables: {},
      }, function (error: any, result: any) {
        if (error) {
          expect(error[0].message).to.equals('Subscription timed out - no response from server');
          done();
        }
        if (result) {
          assert(false);
        }
      });
    }, 100);
  });

  it('should reconnect to the server', function (done) {
    let connections = 0;
    let client: GraphQLTransportWSClient;
    let originalClient: any;
    wsServer.on('connection', (connection: WebSocket) => {
      connections += 1;
      if (connections === 1) {
        originalClient.close();
      } else {
        expect(client.client).to.not.be.equal(originalClient);
        done();
      }
    });
    client = new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`, {reconnect: true});
    originalClient = client.client;
  });

  it('should resubscribe after reconnect', function (done) {
    let connections = 0;
    let client: GraphQLTransportWSClient = null;
    wsServer.on('connection', (connection: WebSocket) => {
      connections += 1;
      connection.on('message', (message: any) => {
        const parsedMessage = JSON.parse(message);
        if (parsedMessage.type === MessageTypes.GQL_SUBSCRIPTION_START) {
          if (connections === 1) {
            client.client.close();
          } else {
            done();
          }
        }
      });
    });
    client = new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`, {reconnect: true});
    client.subscribe({
      query: `
        subscription useInfo{
          invalid
        }
      `,
      variables: {},
    }, function (errors: Error[], result: any) {
      assert(false);
    });
  });

  it('should throw an exception when trying to subscribe when socket is closed', function (done) {
    let client: GraphQLTransportWSClient = null;

    client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`, {reconnect: true});

    setTimeout(() => {
      client.client.close();
    }, 500);

    setTimeout(() => {
      expect(() => {
        client.subscribe({
          query: `
        subscription useInfo{
          invalid
        }
      `,
          variables: {},
        }, function (errors: Error[], result: any) {
          // nothing
        });

        done();
      }).to.throw();
    }, 1000);
  });

  it('should throw an exception when the sent message is not a valid json', function (done) {


    setTimeout(() => {
      expect(() => {
        let client: GraphQLTransportWSClient = null;

        wsServer.on('connection', (connection: any) => {
          connection.on('message', (message: any) => {
            connection.send('invalid json');
          });
        });

        client = new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`);
        done();
      }).to.throw();
    }, 1000);
  });

  it('should stop trying to reconnect to the server', function (done) {
    let connections = 0;
    wsServer.on('connection', (connection: WebSocket) => {
      connections += 1;
      if (connections === 1) {
        wsServer.close();
      } else {
        assert(false);
      }
    });

    const client = new GraphQLTransportWSClient(`ws://localhost:${RAW_TEST_PORT}/`, {
      timeout: 100,
      reconnect: true,
      reconnectionAttempts: 1,
    });
    setTimeout(() => {
      expect(client.client.readyState).to.be.equal(client.client.CLOSED);
      done();
    }, 500);
  });
});

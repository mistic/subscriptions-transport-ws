import {
  expect,
  assert,
  sinon,
  WebSocket,
  subscriptionManager,
  eventsOptions,
  eventsServer,
  httpServer,
  handlers,
  GraphQLTransportWSClient,
  GraphQLTransportWSServer,
  MessageTypes,
  GRAPHQL_WS,
  SubscribeMessage,
  SubscriptionOptions,
  EVENTS_TEST_PORT,
  ONCONNECT_ERROR_TEST_PORT,
  TEST_PORT,
  KEEP_ALIVE_TEST_PORT,
} from '../config';

describe('Server', function () {
  let onSubscribeSpy: sinon.SinonSpy;

  beforeEach(() => {
    onSubscribeSpy = sinon.spy(handlers, 'onSubscribe');
  });

  afterEach(() => {
    if (onSubscribeSpy) {
      onSubscribeSpy.restore();
    }

    if (eventsOptions) {
      eventsOptions.onConnect.reset();
      eventsOptions.onDisconnect.reset();
      eventsOptions.onSubscribe.reset();
      eventsOptions.onUnsubscribe.reset();
    }
  });

  it('should throw an exception when creating a server without subscriptionManager', () => {
    expect(() => {
      new GraphQLTransportWSServer({subscriptionManager: undefined}, {server: httpServer});
    }).to.throw();
  });

  it('should trigger onConnect when client connects and validated', (done) => {
    new GraphQLTransportWSClient(`ws://localhost:${EVENTS_TEST_PORT}/`);

    setTimeout(() => {
      assert(eventsOptions.onConnect.calledOnce);
      done();
    }, 200);
  });

  it('should trigger onConnect with the correct connectionParams', (done) => {
    const connectionParams: any = {
      test: true,
    };

    new GraphQLTransportWSClient(`ws://localhost:${EVENTS_TEST_PORT}/`, {
      connectionParams: connectionParams,
    });

    setTimeout(() => {
      assert(eventsOptions.onConnect.calledOnce);
      expect(JSON.stringify(eventsOptions.onConnect.getCall(0).args[0])).to.equal(JSON.stringify(connectionParams));
      done();
    }, 200);
  });

  it('should trigger onConnect and return init_fail with error', (done) => {
    const connectionCallbackSpy = sinon.spy();

    new GraphQLTransportWSClient(`ws://localhost:${ONCONNECT_ERROR_TEST_PORT}/`, {
      connectionCallback: connectionCallbackSpy,
    });

    setTimeout(() => {
      expect(connectionCallbackSpy.calledOnce).to.be.true;
      expect(connectionCallbackSpy.getCall(0).args[0]).to.equal('Error');
      done();
    }, 200);
  });

  it('should trigger onDisconnect when client disconnects', (done) => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${EVENTS_TEST_PORT}/`);
    client.client.close();

    setTimeout(() => {
      assert(eventsOptions.onDisconnect.calledOnce);
      done();
    }, 200);
  });

  it('should call unsubscribe when client closes the connection', (done) => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${EVENTS_TEST_PORT}/`);
    const spy = sinon.spy(eventsServer, 'unsubscribe');

    client.subscribe({
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
        // nothing
      }
    );

    setTimeout(() => {
      client.client.close();
    }, 500);

    setTimeout(() => {
      assert(spy.calledOnce);
      done();
    }, 1000);
  });

  it('should trigger onSubscribe when client subscribes', (done) => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${EVENTS_TEST_PORT}/`);
    client.subscribe({
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
    }, (error: any, result: any) => {
      if (error) {
        assert(false);
      }
    });

    setTimeout(() => {
      assert(eventsOptions.onSubscribe.calledOnce);
      done();
    }, 200);
  });

  it('should trigger onUnsubscribe when client unsubscribes', (done) => {
    const client = new GraphQLTransportWSClient(`ws://localhost:${EVENTS_TEST_PORT}/`);
    const subId = client.subscribe({
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
    });

    client.unsubscribe(subId);

    setTimeout(() => {
      assert(eventsOptions.onUnsubscribe.calledOnce);
      done();
    }, 200);
  });

  it('should send correct results to multiple clients with subscriptions', function (done) {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    let client1 = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);

    let numResults = 0;
    setTimeout(() => {
      client.subscribe({
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
        if (error) {
          assert(false);
        }
        if (result) {
          assert.property(result, 'user');
          assert.equal(result.user.id, '3');
          assert.equal(result.user.name, 'Jessie');
          numResults++;
        } else {
          // pass
        }
        // if both error and result are null, this was a SUBSCRIPTION_SUCCESS message.
      });
    }, 100);

    const client11 = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    let numResults1 = 0;
    setTimeout(function () {
      client11.subscribe({
        query: `subscription useInfo($id: String) {
          user(id: $id) {
            id
            name
          }
        }`,
        operationName: 'useInfo',
        variables: {
          id: 2,
        },

      }, function (error: any, result: any) {
        if (error) {
          assert(false);
        }
        if (result) {
          assert.property(result, 'user');
          assert.equal(result.user.id, '2');
          assert.equal(result.user.name, 'Marie');
          numResults1++;
        }
        // if both error and result are null, this was a SUBSCRIPTION_SUCCESS message.
      });
    }, 100);

    setTimeout(() => {
      subscriptionManager.publish('user', {});
    }, 200);

    setTimeout(() => {
      client.unsubscribeAll();
      expect(numResults).to.equals(1);
      client1.unsubscribeAll();
      expect(numResults1).to.equals(1);
      done();
    }, 300);

  });

  it('should send a subscription_fail message to client with invalid query', function (done) {
    const client1 = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    setTimeout(function () {
      client1.client.onmessage = (message: any) => {
        let messageData = JSON.parse(message.data);
        assert.equal(messageData.type, MessageTypes.GQL_SUBSCRIPTION_FAIL);
        assert.isAbove(messageData.payload.errors.length, 0, 'Number of errors is greater than 0.');
        done();
      };
      client1.subscribe({
          query: `subscription useInfo($id: String) {
          user(id: $id) {
            id
            birthday
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
    }, 100);

  });

  it('should set up the proper filters when subscribing', function (done) {
    let numTriggers = 0;
    const client3 = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    const client4 = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    setTimeout(() => {
      client3.subscribe({
          query: `subscription userInfoFilter1($id: String) {
            userFiltered(id: $id) {
              id
              name
            }
          }`,
          operationName: 'userInfoFilter1',
          variables: {
            id: 3,
          },
        }, (error: any, result: any) => {
          if (error) {
            assert(false);
          }
          if (result) {
            numTriggers += 1;
            assert.property(result, 'userFiltered');
            assert.equal(result.userFiltered.id, '3');
            assert.equal(result.userFiltered.name, 'Jessie');
          }
          // both null means it's a SUBSCRIPTION_SUCCESS message
        }
      );
      client4.subscribe({
          query: `subscription userInfoFilter1($id: String) {
            userFiltered(id: $id) {
              id
              name
            }
          }`,
          operationName: 'userInfoFilter1',
          variables: {
            id: 1,
          },
        }, (error: any, result: any) => {
          if (result) {
            numTriggers += 1;
            assert.property(result, 'userFiltered');
            assert.equal(result.userFiltered.id, '1');
            assert.equal(result.userFiltered.name, 'Dan');
          }
          if (error) {
            assert(false);
          }
          // both null means SUBSCRIPTION_SUCCESS
        }
      );
    }, 100);
    setTimeout(() => {
      subscriptionManager.publish('userFiltered', {id: 1});
      subscriptionManager.publish('userFiltered', {id: 2});
      subscriptionManager.publish('userFiltered', {id: 3});
    }, 200);
    setTimeout(() => {
      assert.equal(numTriggers, 2);
      done();
    }, 300);
  });

  it('correctly sets the context in onSubscribe', function (done) {
    const CTX = 'testContext';
    const client3 = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    client3.subscribe({
        query: `subscription context {
          context
        }`,
        variables: {},
        context: CTX,
      }, (error: any, result: any) => {
        client3.unsubscribeAll();
        if (error) {
          assert(false);
        }
        if (result) {
          assert.property(result, 'context');
          assert.equal(result.context, CTX);
        }
        done();
      }
    );
    setTimeout(() => {
      subscriptionManager.publish('context', {});
    }, 100);
  });

  it('passes through webSocketRequest to onSubscribe', function (done) {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    client.subscribe({
      query: `
        subscription context {
          context
        }
      `,
      variables: {},
    }, (error: any, result: any) => {
      if (error) {
        assert(false);
      }
    });
    setTimeout(() => {
      assert(onSubscribeSpy.calledOnce);
      expect(onSubscribeSpy.getCall(0).args[2]).to.not.be.undefined;
      done();
    }, 100);
  });

  it('does not send more subscription data after client unsubscribes', function () {
    const client4 = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    setTimeout(() => {
      let subId = client4.subscribe({
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
      client4.unsubscribe(subId);
    }, 100);
    setTimeout(() => {
      subscriptionManager.publish('user', {});
    }, 200);

    client4.client.onmessage = (message: any) => {
      if (JSON.parse(message.data).type === MessageTypes.GQL_SUBSCRIPTION_DATA) {
        assert(false);
      }
    };
  });

  it('rejects a client that does not specify a supported protocol', function (done) {
    const client = new WebSocket(`ws://localhost:${TEST_PORT}/`);

    client.on('close', (code) => {
      if (code === 1002) {
        done();
      } else {
        assert(false);
      }
    });
  });

  it('rejects unparsable message', function (done) {
    const client = new WebSocket(`ws://localhost:${TEST_PORT}/`, GRAPHQL_WS);
    client.onmessage = (message: any) => {
      let messageData = JSON.parse(message.data);
      assert.equal(messageData.type, MessageTypes.GQL_SUBSCRIPTION_FAIL);
      assert.isAbove(messageData.payload.errors.length, 0, 'Number of errors is greater than 0.');
      client.close();
      done();
    };
    client.onopen = () => {
      client.send('HI');
    };
  });

  it('rejects nonsense message', function (done) {
    const client = new WebSocket(`ws://localhost:${TEST_PORT}/`, GRAPHQL_WS);
    client.onmessage = (message: any) => {
      let messageData = JSON.parse(message.data);
      assert.equal(messageData.type, MessageTypes.GQL_SUBSCRIPTION_FAIL);
      assert.isAbove(messageData.payload.errors.length, 0, 'Number of errors is greater than 0.');
      client.close();
      done();
    };
    client.onopen = () => {
      client.send(JSON.stringify({}));
    };
  });

  it('does not crash on unsub for Object.prototype member', function(done) {
    // Use websocket because Client.unsubscribe will only take a number.
    const client = new WebSocket(`ws://localhost:${TEST_PORT}/`, GRAPHQL_WS);

    client.onopen = () => {
      client.send(JSON.stringify({type: MessageTypes.GQL_SUBSCRIPTION_END, id: 'toString'}));
      // Strangely we don't send any acknowledgement for unsubbing from an
      // unknown sub, so we just set a timeout and implicitly assert that
      // there's no uncaught exception within the server code.
      setTimeout(done, 10);
    };
  });

  it('sends back any type of error', function (done) {
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    client.subscribe({
      query: `invalid useInfo{
          error
        }`,
      variables: {},
    }, function (errors: any, result: any) {
      client.unsubscribeAll();
      assert.isAbove(errors.length, 0, 'Number of errors is greater than 0.');
      done();
    });
  });

  it('handles errors prior to graphql execution', function (done) {
    // replace the onSubscribeSpy with a custom handler, the spy will restore
    // the original method
    handlers.onSubscribe = (msg: SubscribeMessage, params: SubscriptionOptions, webSocketRequest: WebSocket) => {
      return Promise.resolve(Object.assign({}, params, {
        context: () => {
          throw new Error('bad');
        },
      }));
    };
    const client = new GraphQLTransportWSClient(`ws://localhost:${TEST_PORT}/`);
    client.subscribe({
      query: `
        subscription context {
          context
        }
      `,
      variables: {},
      context: {},
    }, (error: any, result: any) => {
      client.unsubscribeAll();
      if (error) {
        assert(Array.isArray(error));
        assert.equal(error[0].message, 'bad');
      } else {
        assert(false);
      }
      done();
    });
    setTimeout(() => {
      subscriptionManager.publish('context', {});
    }, 100);
  });

  it('sends a keep alive signal in the socket', function (done) {
    let client = new WebSocket(`ws://localhost:${KEEP_ALIVE_TEST_PORT}/`, GRAPHQL_WS);
    let yieldCount = 0;
    client.onmessage = (message: any) => {
      const parsedMessage = JSON.parse(message.data);
      if (parsedMessage.type === MessageTypes.GQL_CONNECTION_KEEP_ALIVE) {
        yieldCount += 1;
        if (yieldCount > 1) {
          client.close();
          done();
        }
      }
    };
  });
});

'use strict';

const Stream = require('stream');

const Boom = require('@hapi/boom');
const Code = require('@hapi/code');
const Hapi = require('@hapi/hapi');
const Lab = require('@hapi/lab');
const Nipo = require('..');


const internals = {
    BigInt: global.BigInt || ((number) => `${number}n`)
};


const { describe, it } = exports.lab = Lab.script();
const { expect } = Code;


describe('Nipo', () => {

    const prepareServer = async (pinoOptions = {}, serverOptions = {}, nipoOptions = {}) => {

        const log = [];
        const logStream = new Stream.Writable({
            write(chunk, encoding, callback) {

                log.push(JSON.parse(chunk.toString()));
                callback();
            }
        });

        const server = Hapi.server(Object.assign({
            host: '127.0.0.1',
            debug: false
        }, serverOptions));
        await server.register({
            plugin: Nipo,
            options: {
                stream: logStream,
                pino: {
                    level: 'debug',
                    ...pinoOptions
                },
                ...nipoOptions
            }
        });

        return { server, log };
    };

    it('registers with default options', async () => {

        const server = Hapi.server({ debug: false });
        await server.register(Nipo);
    });

    it('logs start and stop', async () => {

        const { server, log } = await prepareServer();

        await server.start();
        await server.stop();

        expect(log).to.have.length(2);
        expect(log.shift()).to.contain({ level: 30, protocol: 'http', msg: 'server-started' });
        expect(log.shift()).to.contain({ level: 30, protocol: 'http', msg: 'server-stopped' });
    });

    describe('response', () => {

        it('is logged with relevant information', async () => {

            const start = Date.now();
            const { server, log } = await prepareServer();
            server.route({ method: 'GET', path: '/', handler: () => 'ok' });

            const res = await server.inject('/');
            expect(res.statusCode).to.equal(200);
            expect(res.payload).to.equal('ok');

            expect(log).to.have.length(1);
            const line = log.shift();

            expect(line).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line.level).to.equal(30);
            expect(line.time).to.be.at.least(start);
            expect(line.time).to.be.at.most(Date.now());
            expect(line.req).to.equal({ id: line.req.id, method: 'get', path: '/', clientIp: '127.0.0.1' });
            expect(line.req.id).to.exist(); // TODO:
            expect(line.route).to.equal({ path: '/' });
            expect(line.res).to.equal({ statusCode: 200, delay: line.res.delay });
            expect(line.res.delay).to.be.at.least(0);
            expect(line.msg).to.equal('request-response');
        });

        it('is logged with correct status code and level', async () => {

            const { server, log } = await prepareServer({ level: 'trace' });
            server.route({ method: 'GET', path: '/', handler: (request, h) => h.response('404').code(404) });

            const res = await server.inject('/');
            expect(res.statusCode).to.equal(404);
            expect(res.payload).to.equal('404');

            expect(log).to.have.length(1);
            const line = log.shift();

            expect(line).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line.level).to.equal(40);
            expect(line.res.statusCode).to.equal(404);
            expect(line.res.delay).to.be.at.least(0);
            expect(line.res.reason).to.not.exist();
            expect(line.msg).to.equal('request-response');
        });

        it('is logged with route realm', async () => {

            const { server, log } = await prepareServer();
            await server.register({
                plugin: {
                    name: 'my-plugin',
                    register(plugin) {

                        plugin.route({ method: 'GET', path: '/', handler: () => 'ok' });
                    }
                }
            });

            const res = await server.inject('/');
            expect(res.statusCode).to.equal(200);
            expect(res.payload).to.equal('ok');

            expect(log).to.have.length(1);
            const line = log.shift();

            expect(line).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line.level).to.equal(30);
            expect(line.route).to.equal({ path: '/', realm: 'my-plugin' });
            expect(line.msg).to.equal('request-response');
        });

        it('is logged with query params', async () => {

            const { server, log } = await prepareServer();
            server.route({ method: 'GET', path: '/', handler: () => 'ok' });

            const res = await server.inject('/?a=b&c=d&a=e');
            expect(res.statusCode).to.equal(200);

            expect(log).to.have.length(1);
            const line = log.shift();

            expect(line).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line.level).to.equal(30);
            expect(line.req.path).to.equal('/?a=b&c=d&a=e');
            expect(line.msg).to.equal('request-response');
        });

        it('handles logResponse option', async () => {

            const { server, log } = await prepareServer({ level: 'info' }, {}, {
                logResponse(request) {

                    return request.path === '/' ? false : request.path === '/log' ? true : 'fatal';
                }
            });
            server.route({ method: 'GET', path: '/', handler: () => 'ok' });

            const res1 = await server.inject('/');
            expect(res1.statusCode).to.equal(200);

            expect(log).to.have.length(0);

            const res2 = await server.inject('/log');
            expect(res2.statusCode).to.equal(404);

            expect(log).to.have.length(1);
            const line1 = log.shift();

            expect(line1).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line1.level).to.equal(40);
            expect(line1.msg).to.equal('request-response');

            const res3 = await server.inject('/fatal');
            expect(res3.statusCode).to.equal(404);

            expect(log).to.have.length(1);
            const line2 = log.shift();

            expect(line2).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line2.level).to.equal(60);
            expect(line2.msg).to.equal('request-response');
        });

        it('is logged with auth information', async () => {

            const { server, log } = await prepareServer({ level: 'info' });

            server.auth.scheme('test-scheme', () => {

                return {
                    authenticate(request, h) {

                        const authorization = request.headers.authorization;
                        if (!authorization) {
                            throw Boom.unauthorized(null, 'Go away');
                        }

                        return h.authenticated({ credentials: { user: authorization } });
                    }
                };
            });
            server.auth.strategy('test', 'test-scheme');

            server.route({ method: 'GET', path: '/', handler: () => 'ok', config: { auth: 'test' } });
            server.route({ method: 'GET', path: '/try', handler: () => 'ok', config: { auth: { strategy: 'test', mode: 'try' } } });

            const res1 = await server.inject('/');
            expect(res1.statusCode).to.equal(401);
            expect(log).to.have.length(1);

            const line1 = log.shift();
            expect(line1).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line1.level).to.equal(40);
            expect(line1.req.auth).to.equal({ valid: false });
            expect(line1.msg).to.equal('request-response');

            const res2 = await server.inject({ url: '/', headers: { authorization: 'yes' } });
            expect(res2.statusCode).to.equal(200);
            expect(log).to.have.length(1);

            const line2 = log.shift();
            expect(line2).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line2.level).to.equal(30);
            expect(line2.req.auth).to.equal({
                valid: true,
                access: false,
                credentials: { user: 'yes' },
                strategy: 'test'
            });
            expect(line2.msg).to.equal('request-response');

            const res3 = await server.inject('/try');
            expect(res3.statusCode).to.equal(200);
            expect(log).to.have.length(1);

            const line3 = log.shift();
            expect(line3).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line3.level).to.equal(30);
            expect(line3.req.auth).to.equal({ valid: false });
            expect(line3.msg).to.equal('request-response');
        });

        it('is logged for handler errors', async () => {

            const { server, log } = await prepareServer({ level: 'warn' });
            server.route({ method: 'GET', path: '/', handler() {

                // Create data object that would crash a normal JSON serializer

                const tea = {};
                tea.toJSON = () => '3';

                const data = {
                    count: internals.BigInt('1'),
                    type: 'china',
                    teas: [
                        1,
                        internals.BigInt('2'),
                        tea,
                        tea
                    ]
                };
                data.data = data;

                return Boom.teapot(undefined, data);
            } });

            const res = await server.inject('/');
            expect(res.statusCode).to.equal(418);

            expect(log).to.have.length(1);
            const line = log.shift();

            expect(line).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line.level).to.equal(40);
            expect(line.res.statusCode).to.equal(418);
            expect(line.res.delay).to.be.at.least(0);
            expect(line.res.reason).to.equal('Error: I\'m a teapot');
            expect(line.res.data).to.equal({
                type: 'china',
                count: '1n',
                teas: [1, '2n', '3', '3'],
                data: '[Circular]'
            });
            expect(line.msg).to.equal('request-response');
        });

        it('is logged for pre-routing errors', async () => {

            const { server, log } = await prepareServer({ level: 'warn' });
            server.route({ method: 'GET', path: '/', handler: () => 'ok' });

            server.ext('onRequest', () => {

                throw new Error('fail');
            });

            const res = await server.inject('/');
            expect(res.statusCode).to.equal(500);

            const line = log.pop();
            expect(line).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line.level).to.equal(50);
            expect(line.route).to.equal({});
            expect(line.res.statusCode).to.equal(500);
            expect(line.res.delay).to.be.at.least(0);
            expect(line.res.reason).to.equal('Error: fail');

            await server.stop();
        });

        it('logs "fatal" event for processing errors', async () => {

            const { server, log } = await prepareServer({ level: 'trace' });
            server.route({ method: 'GET', path: '/', handler: () => 'ok' });

            server.plugins.nipo.responseLogger.info = null;

            const res1 = await server.inject('/');
            expect(res1.statusCode).to.equal(200);

            expect(log).to.have.length(1);
            const line1 = log.shift();

            expect(line1).to.only.contain(['level', 'time', 'server', 'type', 'message', 'stack', 'msg']);
            expect(line1.level).to.equal(60);
            expect(line1.message).to.equal('nipo.responseLogger[logLevel] is not a function');
            expect(line1.msg).to.equal('nipo-error');

            server.plugins.nipo.responseLogger.info = () => {

                throw undefined;
            };

            const res2 = await server.inject('/');
            expect(res2.statusCode).to.equal(200);

            expect(log).to.have.length(1);
            const line2 = log.shift();

            expect(line2).to.only.contain(['level', 'time', 'server', 'type', 'message', 'stack', 'msg']);
            expect(line2.level).to.equal(60);
            expect(line2.message).to.equal('Unknown throw during: onResponseHandler');
            expect(line2.msg).to.equal('nipo-error');

        });
    });

    describe('events', () => {

        it('logs server "app" events', async () => {

            const { server, log } = await prepareServer();

            server.log(['my', 'app'], internals.BigInt(1000));

            expect(log).to.have.length(1);
            const line = log.shift();

            expect(line).to.only.contain(['level', 'time', 'server', 'tags', 'data', 'msg']);
            expect(line.level).to.equal(30);
            expect(line.tags).to.equal(['my', 'app']);
            expect(line.data).to.equal('1000n');
            expect(line.msg).to.equal('log-app');
        });

        it('supports custom server "app" event levels', async () => {

            const { server, log } = await prepareServer({}, {}, {
                tagLevels: { hello: 'debug', my: 'warn' }
            });

            server.log(['app', 'trace'], 0);
            server.log(['my', 'app'], 1);
            server.log(['my', 'app', 'hello'], 2);
            server.log(['app', 'hello'], 3);
            server.log(['app'], 4);

            expect(log).to.have.length(4);

            expect(log.shift().level).to.equal(40);
            expect(log.shift().level).to.equal(40);
            expect(log.shift().level).to.equal(20);
            expect(log.shift().level).to.equal(30);
        });

        it('logs request "app" events', async () => {

            const { server, log } = await prepareServer({ level: 'trace' });
            server.route({ method: 'GET', path: '/', handler(request) {

                request.log(['my', 'handler'], internals.BigInt(42));
                return 'ok';
            } });

            const res = await server.inject('/');
            expect(res.statusCode).to.equal(200);

            expect(log).to.have.length(2);
            const line1 = log.shift();

            expect(line1).to.only.contain(['level', 'time', 'request', 'tags', 'data', 'msg']);
            expect(line1.level).to.equal(30);
            expect(line1.tags).to.equal(['my', 'handler']);
            expect(line1.data).to.equal('42n');
            expect(line1.msg).to.equal('request-app');

            const line2 = log.shift();
            expect(line2).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line2.req.id).to.equal(line1.request);
            expect(line2.res.delay).to.be.at.least(0);
            expect(line2.res.statusCode).to.equal(200);
            expect(line2.msg).to.equal('request-response');
        });

        it('supports custom request "app" event levels', async () => {

            const { server, log } = await prepareServer({ level: 'debug' }, {}, {
                tagLevels: { hello: 'debug', my: 'warn' }
            });
            server.route({ method: 'GET', path: '/', handler(request) {

                request.log(['handler', 'trace'], 0);
                request.log(['my', 'handler'], 1);
                request.log(['my', 'handler', 'hello'], 2);
                request.log(['handler', 'hello'], 3);
                request.log(['handler'], 4);
                return 'ok';
            } });

            const res = await server.inject('/');
            expect(res.statusCode).to.equal(200);

            expect(log).to.have.length(5);

            expect(log.shift().level).to.equal(40);
            expect(log.shift().level).to.equal(40);
            expect(log.shift().level).to.equal(20);
            expect(log.shift().level).to.equal(30);
        });

        it('handles level changes', async () => {

            const { server, log } = await prepareServer();

            server.log(['my', 'app'], internals.BigInt(1000));

            server.plugins.nipo.eventLogger.level = 'error';
            server.log(['my', 'app'], internals.BigInt(1001));

            server.plugins.nipo.eventLogger.level = 'info';
            server.log(['my', 'app'], internals.BigInt(1002));

            expect(log).to.have.length(2);
            const line1 = log.shift();

            expect(line1).to.only.contain(['level', 'time', 'server', 'tags', 'data', 'msg']);
            expect(line1.level).to.equal(30);
            expect(line1.tags).to.equal(['my', 'app']);
            expect(line1.data).to.equal('1000n');
            expect(line1.msg).to.equal('log-app');

            const line2 = log.shift();

            expect(line2).to.only.contain(['level', 'time', 'server', 'tags', 'data', 'msg']);
            expect(line2.level).to.equal(30);
            expect(line2.tags).to.equal(['my', 'app']);
            expect(line2.data).to.equal('1002n');
            expect(line2.msg).to.equal('log-app');
        });

        it('logs "trace" level error details for responses', async () => {

            const { server, log } = await prepareServer({ level: 'trace' });
            server.route({ method: 'GET', path: '/', handler() { }, config: { validate: { query: { a: 'number ' } } } });

            const res = await server.inject('/?a=b');
            expect(res.statusCode).to.equal(400);

            expect(log).to.have.length(2);

            const line1 = log.shift();
            expect(line1).to.only.contain(['level', 'time', 'request', 'tags', 'err', 'msg']);
            expect(line1.level).to.equal(10);
            expect(line1.request).to.exist();
            expect(line1.tags).to.equal(['request', 'response', 'error']);
            expect(typeof line1.err.stack).to.equal('string');
            expect(line1.msg).to.equal('request-internal');

            const line2 = log.shift();
            expect(line2).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line2.level).to.equal(40);
            expect(line2.req.id).to.equal(line1.request);
            expect(line2.res.statusCode).to.equal(400);
            expect(line2.res.delay).to.be.at.least(0);
            expect(line2.res.reason).to.equal('Error: Invalid request query input');
            expect(line2.msg).to.equal('request-response');
        });

        it('logs "fatal" level for implementation errors', async () => {

            const { server, log } = await prepareServer({ level: 'info' });
            server.route({
                method: 'GET', path: '/', handler(request, h) {

                    // eslint-disable-next-line no-unused-vars
                    const a = 1;
                    // eslint-disable-next-line no-const-assign
                    a = 2;
                }
            });

            const res = await server.inject('/');
            expect(res.statusCode).to.equal(500);

            expect(log).to.have.length(2);

            const line1 = log.shift();
            expect(line1).to.only.contain(['level', 'time', 'request', 'tags', 'err', 'msg']);
            expect(line1.level).to.equal(60);
            expect(line1.request).to.exist();
            expect(line1.tags).to.equal(['internal', 'implementation', 'error']);
            expect(line1.err.type).to.equal('TypeError');
            expect(typeof line1.err.stack).to.equal('string');
            expect(line1.msg).to.equal('request-error');

            const line2 = log.shift();
            expect(line2).to.only.contain(['level', 'time', 'req', 'route', 'res', 'msg']);
            expect(line2.level).to.equal(50);
            expect(line2.req.id).to.equal(line1.request);
            expect(line2.res.statusCode).to.equal(500);
            expect(line2.res.delay).to.be.at.least(0);
            expect(line2.res.reason).to.equal('TypeError: Assignment to constant variable.');
            expect(line2.msg).to.equal('request-response');
        });
    });
});

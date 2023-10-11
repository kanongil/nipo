import { Server, Request } from '@hapi/hapi';

import * as Nipo from "../";
import * as Lab from '@hapi/lab';
import { Logger, Level } from 'pino';

const { expect } = Lab.types;

const server = new Server();

await server.register({
    plugin: Nipo,
    options: {
        logResponse(request) {
            expect.type<Request>(request);

            return 'debug';
        },
        tagLevels: {
            test: 'debug'
        },
        pino: {
            prettyPrint: false
        }
    }
});

server.route({
    method: 'GET',
    path: '/',
    options: {
        handler: () => 'ok',
        plugins: {
            nipo: {
                req: {
                    headers: 'headers'
                },
                res: {
                    headers: 'response.headers'
                }
            }
        }
    }
});

expect.type<Logger>(server.plugins.nipo.eventLogger);
expect.type<Logger>(server.plugins.nipo.responseLogger);
expect.type<Map<string, Level>>(server.plugins.nipo.tagLevels);

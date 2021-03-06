'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testPipeline = require('./data/pipeline.json');
const testPipelines = require('./data/pipelines.json');
const testJobs = require('./data/jobs.json');
const testBuilds = require('./data/builds.json');
const testSecrets = require('./data/secrets.json');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

const decorateBuildMock = (build) => {
    const mock = hoek.clone(build);

    mock.toJson = sinon.stub().returns(build);

    return mock;
};

const getBuildMocks = (builds) => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildMock);
    }

    return decorateBuildMock(builds);
};

const decorateJobMock = (job) => {
    const mock = hoek.clone(job);

    mock.getBuilds = sinon.stub().resolves(getBuildMocks(testBuilds));
    mock.toJson = sinon.stub().returns(job);

    return mock;
};

const getJobsMocks = (jobs) => {
    if (Array.isArray(jobs)) {
        return jobs.map(decorateJobMock);
    }

    return decorateJobMock(jobs);
};

const decoratePipelineMock = (pipeline) => {
    const mock = hoek.clone(pipeline);

    mock.sync = sinon.stub();
    mock.update = sinon.stub();
    mock.formatScmUrl = sinon.stub();
    mock.toJson = sinon.stub().returns(pipeline);
    mock.jobs = sinon.stub();
    mock.getJobs = sinon.stub();
    mock.remove = sinon.stub();

    return mock;
};

const getPipelineMocks = (pipelines) => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decoratePipelineMock);
    }

    return decoratePipelineMock(pipelines);
};

const decorateSecretMock = (secret) => {
    const mock = hoek.clone(secret);

    mock.toJson = sinon.stub().returns(secret);

    return mock;
};

const getSecretsMocks = (secrets) => {
    if (Array.isArray(secrets)) {
        return secrets.map(decorateSecretMock);
    }

    return decorateJobMock(secrets);
};

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.update = sinon.stub();
    mock.sealToken = sinon.stub();
    mock.unsealToken = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

describe('pipeline plugin test', () => {
    let pipelineFactoryMock;
    let userFactoryMock;
    let scmMock;
    let plugin;
    let server;
    const password = 'this_is_a_password_that_needs_to_be_atleast_32_characters';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        pipelineFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            list: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        scmMock = {
            getRepoId: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            ecosystem: {
                badges: '{{status}}/{{color}}'
            }
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({})
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

        server.register([{
            register: plugin,
            options: {
                password,
                scmPlugin: scmMock
            }
        }, {
            // eslint-disable-next-line global-require
            register: require('../../plugins/secrets'),
            options: {
                password
            }
        }
    ], (err) => {
            done(err);
        });
    });

    afterEach(() => {
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.equal(server.registrations.pipelines.options.password, password);
        assert.isOk(server.registrations.pipelines);
    });

    describe('GET /pipelines', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipelines?page=1&count=3'
            };
        });

        it('returns 200 and all pipelines', (done) => {
            pipelineFactoryMock.list.resolves(getPipelineMocks(testPipelines));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines);
                assert.calledWith(pipelineFactoryMock.list, {
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                });
                done();
            });
        });

        it('returns 500 when datastore fails', (done) => {
            pipelineFactoryMock.list.rejects(new Error('fittoburst'));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('GET /pipelines/{id}', () => {
        const id = 'cf23df2207d99a74fbe169e3eba035e633b65d94';
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}`
            };
        });

        it('exposes a route for getting a pipeline', (done) => {
            pipelineFactoryMock.get.withArgs(id).resolves(getPipelineMocks(testPipeline));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipeline);
                done();
            });
        });

        it('throws error not found when pipeline does not exist', (done) => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.withArgs(id).resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('throws error when call returns error', (done) => {
            pipelineFactoryMock.get.withArgs(id).rejects(new Error('Failed'));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('DELETE /pipelines/{id}', () => {
        const id = 'cf23df2207d99a74fbe169e3eba035e633b65d94';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const username = 'myself';
        let pipeline;
        let options;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${id}`,
                credentials: {
                    username,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUrl).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

            pipeline = getPipelineMocks(testPipeline);
            pipeline.remove.resolves(null);
            pipelineFactoryMock.get.withArgs(id).resolves(pipeline);
        });

        it('returns 200 when delete successfully', (done) => {
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                done();
            });
        });

        it('returns 200 when user does not have admin permission', (done) => {
            const error = {
                statusCode: 401,
                error: 'Unauthorized',
                message: 'User myself does not have admin permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUrl).resolves({ admin: false });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 401);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('returns 404 when pipeline does not exist', (done) => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.withArgs(id).resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('returns 404 when user does not exist', (done) => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User myself does not exist'
            };

            userFactoryMock.get.withArgs({ username }).resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('returns 500 when call returns error', (done) => {
            pipeline.remove.rejects('pipelineRemoveError');
            pipelineFactoryMock.get.withArgs(id).resolves(pipeline);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('GET /pipelines/{id}/jobs', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        let options;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/jobs`
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.getJobs.resolves(getJobsMocks(testJobs));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for getting jobs', (done) => {
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getJobs, {
                    params: {
                        archived: false
                    },
                    paginate: {
                        count: 50,
                        page: 1
                    }
                });
                assert.deepEqual(reply.result, testJobs);
                done();
            });
        });

        it('returns 400 for wrong query format', (done) => {
            pipelineFactoryMock.get.resolves(null);
            options.url = `/pipelines/${id}/jobs?archived=blah`;

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 400);
                done();
            });
        });

        it('returns 404 for updating a pipeline that does not exist', (done) => {
            pipelineFactoryMock.get.resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when the datastore returns an error', (done) => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('pass in the correct params to getJobs', (done) => {
            options.url = `/pipelines/${id}/jobs?page=2&count=30&archived=true`;

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getJobs, {
                    params: {
                        archived: true
                    },
                    paginate: {
                        count: 30,
                        page: 2
                    }
                });
                assert.deepEqual(reply.result, testJobs);
                done();
            });
        });
    });

    describe('GET /pipelines/{id}/jobs', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        let pipelineMock;

        beforeEach(() => {
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.jobs = Promise.resolve(getJobsMocks(testJobs));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 302 to for a valid build', () => (
            server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'failure/red');
            })
        ));

        it('returns 302 to unknown for a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'unknown/lightgrey');
            });
        });

        it('returns 302 to unknown for a job that does not exist', () => {
            pipelineMock.jobs = Promise.resolve([]);

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'unknown/lightgrey');
            });
        });

        it('returns 302 to unknown for a build that does not exist', () => {
            const mockJobs = getJobsMocks(testJobs);

            mockJobs[0].getBuilds.resolves([]);
            pipelineMock.jobs = Promise.resolve(mockJobs);

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'unknown/lightgrey');
            });
        });

        it('returns 302 to unknown when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'unknown/lightgrey');
            });
        });
    });

    describe('GET /pipelines/{id}/secrets', () => {
        const pipelineId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const username = 'myself';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        let options;
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${pipelineId}/secrets`,
                credentials: {
                    username,
                    scope: ['user']
                }
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.secrets = getSecretsMocks(testSecrets);
            pipelineFactoryMock.get.resolves(pipelineMock);

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUrl).resolves({ push: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);
        });

        it('returns 404 for updating a pipeline that does not exist', (done) => {
            pipelineFactoryMock.get.resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 403 when the user does not have push permissions', (done) => {
            userMock.getPermissions.withArgs(scmUrl).resolves({ push: false });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 403);
                done();
            });
        });

        it('returns empty array if secrets is empty', (done) => {
            pipelineMock.secrets = getSecretsMocks([]);
            pipelineFactoryMock.get.resolves(pipelineMock);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                done();
            });
        });

        it('returns 200 for getting secrets', (done) => {
            server.inject(options, (reply) => {
                const expected = [{
                    id: 'a123fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    pipelineId: 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    name: 'NPM_TOKEN',
                    allowInPR: false
                }, {
                    id: 'b456fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    pipelineId: 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    name: 'GIT_TOKEN',
                    allowInPR: true
                }];

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
                done();
            });
        });
    });

    describe('PUT /pipelines/{id}', () => {
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#batman';
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        let pipelineMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/pipelines/${id}`,
                payload: {
                    scmUrl
                },
                credentials: {
                    scope: ['user']
                }
            };

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.update.resolves(pipelineMock);
            pipelineMock.sync.resolves();
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for updating a pipeline that exists', (done) => {
            const expected = hoek.applyToDefaults(testPipeline, { scmUrl });

            pipelineMock.toJson.returns(expected);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
                done();
            });
        });

        it('returns 404 for updating a pipeline that does not exist', (done) => {
            pipelineFactoryMock.get.resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when the datastore returns an error', (done) => {
            pipelineMock.sync.rejects(new Error('icantdothatdave'));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('POST /pipelines', () => {
        let options;
        const unformattedScmUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const scmRepo = {
            id: 'github.com:123456:master'
        };
        const token = 'secrettoken';
        const testId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const username = 'd2lam';
        const job = {
            id: 'someJobId',
            other: 'dataToBeIncluded'
        };
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/pipelines',
                payload: {
                    scmUrl: unformattedScmUrl
                },
                credentials: {
                    username,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUrl).resolves({ admin: true });
            userMock.unsealToken.resolves(token);
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.sync.resolves(job);

            pipelineFactoryMock.get.resolves(null);
            pipelineFactoryMock.create.resolves(pipelineMock);

            scmMock.getRepoId.withArgs({ scmUrl, token }).resolves(scmRepo);
        });

        it('returns 201 and correct pipeline data', (done) => {
            let expectedLocation;

            server.inject(options, (reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testPipeline);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(pipelineFactoryMock.create, {
                    admins: {
                        d2lam: true
                    },
                    scmUrl
                });
                done();
            });
        });

        it('formats scmUrl correctly', (done) => {
            const goodScmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';

            options.payload.scmUrl = goodScmUrl;

            userMock.getPermissions.withArgs(goodScmUrl).resolves({ admin: false });

            server.inject(options, () => {
                assert.calledWith(userMock.getPermissions, goodScmUrl);
                done();
            });
        });

        it('returns 401 when the user does not have admin permissions', (done) => {
            userMock.getPermissions.withArgs(scmUrl).resolves({ admin: false });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 401);
                done();
            });
        });

        it('returns 409 when the scmUrl already exists', (done) => {
            pipelineFactoryMock.get.resolves(pipelineMock);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 409);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to get', (done) => {
            const testError = new Error('pipelineModelGetError');

            pipelineFactoryMock.get.rejects(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to create', (done) => {
            const testError = new Error('pipelineModelCreateError');

            pipelineFactoryMock.create.rejects(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to sync during create', (done) => {
            const testError = new Error('pipelineModelSyncError');

            pipelineMock.sync.rejects(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });
});

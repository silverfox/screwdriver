'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.secret.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/secrets/{id}',
    config: {
        description: 'Remove a single secret',
        notes: 'Returns null if successful',
        tags: ['api', 'secrets'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const secretFactory = request.server.app.secretFactory;
            const credentials = request.auth.credentials;
            const canAccess = request.server.plugins.secrets.canAccess;

            // Get the secret first
            return secretFactory.get(request.params.id)
                .then(secret => {
                    if (!secret) {
                        throw boom.notFound('Secret does not exist');
                    }

                    // Make sure that user/build has permission before deleting
                    return canAccess(credentials, secret).then(() =>
                        reply(secret.remove()));
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});

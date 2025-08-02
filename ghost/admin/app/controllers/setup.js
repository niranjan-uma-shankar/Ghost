import classic from 'ember-classic-decorator';
import {inject as service} from '@ember/service';
/* eslint-disable camelcase, ghost/ember/alias-model-in-controller */
import Controller, {inject as controller} from '@ember/controller';
import ValidationEngine from 'ghost-admin/mixins/validation-engine';
import {action} from '@ember/object';
import {getGMTOffset, maybeFetchAliasTimezone, timezoneDataWithGMTOffset} from '@tryghost/timezone-data';
import {htmlSafe} from '@ember/template';
import {inject} from 'ghost-admin/decorators/inject';
import {isInvalidError} from 'ember-ajax/errors';
import {isVersionMismatchError} from 'ghost-admin/services/ajax';
import {task} from 'ember-concurrency';

@classic
export default class SetupController extends Controller.extend(ValidationEngine) {
    @controller application;

    @service ajax;
    @service ghostPaths;
    @service notifications;
    @service router;
    @service session;
    @service settings;

    @inject config;

    // ValidationEngine settings
    validationType = 'setup';

    blogCreated = false;
    blogTitle = null;
    email = '';
    flowErrors = '';
    name = null;
    password = null;

    @action
    setup() {
        this.setupTask.perform();
    }

    @action
    preValidate(model) {
        // Only triggers validation if a value has been entered, preventing empty errors on focusOut
        if (this.get(model)) {
            return this.validate({property: model});
        }
    }

    @task(function* () {
        return yield this._passwordSetup();
    })
        setupTask;

    @task(function* (authStrategy, {identification, password}) {
        // we don't want to redirect after sign-in during setup
        this.session.skipAuthSuccessHandler = true;

        try {
            yield this.session.authenticate(authStrategy, {identification, password});

            this.errors.remove('session');

            return true;
        } catch (error) {
            // handle setup/done route redirecting to dashboard
            if (error.message === 'TransitionAborted') {
                return true;
            }

            if (error && error.payload && error.payload.errors) {
                if (isVersionMismatchError(error)) {
                    return this.notifications.showAPIError(error);
                }

                error.payload.errors.forEach((err) => {
                    err.message = htmlSafe(err.message);
                });

                this.set('flowErrors', error.payload.errors[0].message.string);
            } else {
                // Connection errors don't return proper status message, only req.body
                this.notifications.showAlert('There was a problem on the server.', {type: 'error', key: 'session.authenticate.failed'});
            }

            return false;
        }
    })
        authenticate;

    _passwordSetup() {
        let setupProperties = ['blogTitle', 'name', 'email', 'password'];
        let data = this.getProperties(setupProperties);
        let method = this.blogCreated ? 'put' : 'post';

        this.set('flowErrors', '');

        this.hasValidated.addObjects(setupProperties);

        return this.validate().then(() => {
            let authUrl = this.get('ghostPaths.url').api('authentication', 'setup');

            return this.ajax[method](authUrl, {
                data: {
                    setup: [{
                        name: data.name,
                        email: data.email,
                        password: data.password,
                        blogTitle: data.blogTitle
                    }]
                }
            }).then((result) => {
                this.config.blogTitle = data.blogTitle;

                // don't try to login again if we are already logged in
                if (this.get('session.isAuthenticated')) {
                    return this._afterAuthentication(result);
                }

                // Don't call the success handler, otherwise we will be redirected to admin
                this.session.skipAuthSuccessHandler = true;

                return this.session.authenticate('authenticator:cookie', {identification: data.email, password: data.password}).then(() => {
                    this.set('blogCreated', true);
                    return this._afterAuthentication(result);
                }).catch((error) => {
                    this._handleAuthenticationError(error);
                });
            }).catch((error) => {
                this._handleSaveError(error);
            });
        }).catch(() => {
            this.set('flowErrors', 'Please fill out every field correctly to set up your site.');
        });
    }

    async _setUserTimezone() {
        // Ensure settings are loaded
        if (!this.settings.settingsModel) {
            await this.settings.fetch();
        }
        
        // Check if timezone setting already exists
        const currentTimezone = this.settings.timezone;
        
        // Only set timezone if it doesn't exist or is the default value
        // This prevents overriding user-configured timezones
        if (currentTimezone && currentTimezone !== 'Etc/UTC') {
            // Timezone already set to a non-default value, don't override
            return;
        }

        // Get the best matching timezone for the current browser timezone
        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const tzData = timezoneDataWithGMTOffset();
        const aliasTimezone = maybeFetchAliasTimezone(browserTimezone);
    
        let match = tzData.find(({name}) => {
            return browserTimezone === name || aliasTimezone === name;
        });
    
        if (!match) {
            const timezonePart = browserTimezone.split('/').pop()?.replace(/_/g, ' ') || '';
            match = tzData.find(({label}) => {
                return label.includes(timezonePart);
            });
        }
   
        if (!match) {
            const browserTimezoneOffset = getGMTOffset(browserTimezone);
            match = tzData.find(({offsetMinutes}) => {
                return offsetMinutes === browserTimezoneOffset.offsetMinutes;
            });
        }

        const publicationTimezone = match ? match.name : 'Etc/UTC';

        // Use the settings API to set the timezone
        const settingsUrl = this.get('ghostPaths.url').api('settings');
        const timezoneSetting = {
            key: 'timezone',
            value: publicationTimezone
        };

        try {
            await this.ajax.put(settingsUrl, {
                data: {
                    settings: [timezoneSetting]
                }
            });
            
            // Reload settings to update local state after successful API call
            await this.settings.reload();
        } catch (error) {
            // Log error but don't fail the setup process
            // eslint-disable-next-line no-console
            console.warn('Failed to set timezone:', error);
        }
    }

    _handleSaveError(resp) {
        if (isInvalidError(resp)) {
            let [error] = resp.payload.errors;
            this.set('flowErrors', [error.message, error.context].join(' '));
        } else {
            this.notifications.showAPIError(resp, {key: 'setup.blog-details'});
        }
    }

    _handleAuthenticationError(error) {
        if (error && error.payload && error.payload.errors) {
            let [apiError] = error.payload.errors;
            this.set('flowErrors', [apiError.message, apiError.context].join(' '));
        } else {
            // ignore setup/done route redirecting to dashboard
            if (error.message === 'TransitionAborted') {
                return true;
            }

            // Connection errors don't return proper status message, only req.body
            this.notifications.showAlert('There was a problem on the server.', {type: 'error', key: 'setup.authenticate.failed'});
        }
    }

    async _afterAuthentication() {
        await this.session.handleAuthentication();
        // Set timezone after successful setup
        await this._setUserTimezone();

        return this.router.transitionTo('setup.done');
    }
}

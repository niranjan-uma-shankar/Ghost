import {TrackedObject} from 'tracked-built-ins';
import {getGMTOffset, maybeFetchAliasTimezone, timezoneDataWithGMTOffset} from '@tryghost/timezone-data';

export function initialize(applicationInstance) {
    const config = new TrackedObject({});

    Object.defineProperty(config, 'availableTimezones', {
        get() {
            return timezoneDataWithGMTOffset();
        },
        enumerable: true
    });

    Object.defineProperty(config, 'defaultTimezone', {
        get() {
            try {
                // Use Intl API to get the browser's timezone
                return Intl.DateTimeFormat().resolvedOptions().timeZone;
            } catch (error) {
                // Fallback to a default timezone if Intl API fails
                return 'Etc/UTC';
            }
        },
        enumerable: true
    });

    Object.defineProperty(config, 'blogDomain', {
        get() {
            const blogDomain = this.blogUrl
                .replace(/^https?:\/\//, '')
                .replace(/\/?$/, '');

            return blogDomain;
        },
        enumerable: true

    });

    Object.defineProperty(config, 'emailDomain', {
        get() {
            const blogDomain = this.blogDomain || '';
            const domainExp = blogDomain.match(new RegExp('^([^/:?#]+)(?:[/:?#]|$)', 'i'));
            const domain = (domainExp && domainExp[1]) || '';
            if (domain.startsWith('www.')) {
                return domain.replace(/^(www)\.(?=[^/]*\..{2,5})/, '');
            }
            return domain;
        },
        enumerable: true
    });

    Object.defineProperty(config, 'getSiteUrl', {
        value: function (path) {
            const siteUrl = new URL(this.blogUrl);
            const subdir = siteUrl.pathname.endsWith('/') ? siteUrl.pathname : `${siteUrl.pathname}/`;
            const fullPath = `${subdir}${path.replace(/^\//, '')}`;

            return `${siteUrl.origin}${fullPath}`;
        }
    });

    // Add timezone detection and initialization
    Object.defineProperty(config, 'initializeTimezone', {
        value: async function () {
            try {
                // Detect browser timezone
                const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const timezoneData = timezoneDataWithGMTOffset();
                
                // Find matching timezone using the same logic as findMatchingTimezone
                const aliasTimezone = maybeFetchAliasTimezone(browserTimezone);
                let match = timezoneData.find(({name}) => {
                    return browserTimezone === name || aliasTimezone === name;
                });

                if (!match) {
                    const timezonePart = browserTimezone.split('/').pop()?.replace(/_/g, ' ') || '';
                    match = timezoneData.find(({label}) => {
                        return label.includes(timezonePart);
                    });
                }

                if (!match) {
                    const currentTimezoneOffset = getGMTOffset(browserTimezone);
                    match = timezoneData.find(({offsetMinutes}) => {
                        return offsetMinutes === currentTimezoneOffset.offsetMinutes;
                    });
                }
                return match ? match.name : 'Etc/UTC';
            } catch (error) {
                console.warn('Timezone detection failed:', error);
            }
            return null;
        }
    });

    applicationInstance.register('config:main', config, {instantiate: false});
    
    // Auto-initialize timezone when admin loads
    // We need to wait for the application to be ready
    applicationInstance.lookup('service:store').then(store => {
        // Check if timezone is already set
        store.queryRecord('setting', {key: 'timezone'}).then(setting => {
            if (!setting || !setting.value || setting.value === 'UTC' || setting.value === '') {
                // Only set if timezone is not already configured
                config.initializeTimezone();
            }
        }).catch(() => {
            // If query fails, try to set timezone anyway
            config.initializeTimezone();
        });
    });
}

export default {
    name: 'config',
    initialize
};

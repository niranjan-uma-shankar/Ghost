import React, {useEffect, useState} from 'react';
import TopLevelGroup from '../../TopLevelGroup';
import useSettingGroup from '../../../hooks/useSettingGroup';
import {Select, SettingGroupContent, withErrorBoundary} from '@tryghost/admin-x-design-system';
import {TimezoneDataWithOffset} from '../../../utils/types';
import {findMatchingTimezone, getLocalTime} from '../../../utils/helpers';
import {getSettingValues} from '@tryghost/admin-x-framework/api/settings';
import {timezoneDataWithGMTOffset} from '@tryghost/timezone-data';

interface TimezoneDataDropdownOption {
    name: string;
    label: string;
}

interface HintProps {
    timezone: string;
}

const Hint: React.FC<HintProps> = ({timezone}) => {
    const [currentTime, setCurrentTime] = useState(getLocalTime(timezone || 'Etc/UTC'));

    useEffect(() => {
        if (!timezone) {
            return;
        }
        const timer = setInterval(() => {
            setCurrentTime(getLocalTime(timezone));
        }, 1000);

        return () => {
            clearInterval(timer);
        };
    }, [timezone]);
    
    if (!timezone) {
        return null;
    }
    
    return (
        <>
            The local time here is currently {currentTime}
        </>
    );
};

const TimeZone: React.FC<{ keywords: string[] }> = ({keywords}) => {
    const {
        localSettings,
        isEditing,
        saveState,
        handleSave,
        handleCancel,
        updateSetting,
        handleEditingChange
    } = useSettingGroup();

    let [publicationTimezone] = getSettingValues(localSettings, ['timezone']) as string[];
    const timezoneData: TimezoneDataWithOffset[] = timezoneDataWithGMTOffset();
    const timezoneOptions: Array<{value: string; label: string}> = timezoneData.map((tzOption: TimezoneDataDropdownOption) => {
        return {
            value: tzOption.name,
            label: tzOption.label
        };
    });

    const [shouldSaveAfterUpdate, setShouldSaveAfterUpdate] = useState(false);

    // Only run during initialization when no timezone is set
    useEffect(() => {
        if (!publicationTimezone && timezoneData.length > 0) {
            const defaultTimezone = findMatchingTimezone(timezoneData);
            updateSetting('timezone', defaultTimezone || null);
            setShouldSaveAfterUpdate(true);
        }
    }, [publicationTimezone, timezoneData, updateSetting]);

    // Only run when we're saving after initialization
    useEffect(() => {
        if (shouldSaveAfterUpdate && publicationTimezone && saveState === 'unsaved') {
            setShouldSaveAfterUpdate(false);
            handleSave({force: true});
        }
    }, [shouldSaveAfterUpdate, publicationTimezone, saveState, handleSave]);
    
    const handleTimezoneChange = (value?: string) => {
        updateSetting('timezone', value || null);
        handleEditingChange(true);
    };

    return (
        <TopLevelGroup
            description='Set the time and date of your publication, used for all published posts'
            hideEditButton={true}
            isEditing={isEditing}
            keywords={keywords}
            navid='timezone'
            saveState={saveState}
            testId='timezone'
            title='Site timezone'
            onCancel={handleCancel}
            onEditingChange={handleEditingChange}
            onSave={handleSave}
        >
            <SettingGroupContent columns={1}>
                <Select
                    hint={<Hint timezone={publicationTimezone} />}
                    options={timezoneOptions}
                    selectedOption={timezoneOptions.find(option => option.value === publicationTimezone)}
                    testId='timezone-select'
                    title="Site timezone"
                    isSearchable
                    onSelect={option => handleTimezoneChange(option?.value)}
                />
            </SettingGroupContent>
        </TopLevelGroup>
    );
};

export default withErrorBoundary(TimeZone, 'Site timezone');

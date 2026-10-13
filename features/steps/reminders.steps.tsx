// features/steps/reminders.steps.tsx — runs features/reminders.feature (mw-ev7oyy.9): the Reminders section
// of the real Me screen, and a reminder push built from whatever settingsRepo then holds — the same read
// src/sw.ts's push handler does (tests/unit/reminder-settings.test.ts runs the real worker).
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { notificationSpecForClass } from '../../src/push/classOptions';
import { notificationSpecForReminder } from '../../src/push/reminder';

async function openMe(): Promise<void> {
  cleanup();
  await db.settings.clear();
  render(<MeScreen />);
  await screen.findByTestId('notification-row-message');
}

const reminders = async () => within(await screen.findByRole('region', { name: 'Reminders' }));
const pushAt = async (time: string) => notificationSpecForReminder('direct:aa', await settingsRepo.getReminderSettings(), new Date(`2026-10-13T${time}:00Z`));

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/reminders.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-ev7oyy.9 AC-4: the Me screen has a Reminders section of its own with sound on and quiet hours off', ({ Given, Then, And }) => {
    Given('the Me screen is opened', openMe);
    Then('there is a Reminders section apart from the Notifications rows', async () => {
      const section = await screen.findByRole('region', { name: 'Reminders' });
      expect(section).not.toBe(await screen.findByRole('region', { name: 'Notifications' }));
      expect(within(await screen.findByRole('region', { name: 'Notifications' })).queryByText('Reminders')).toBeNull();
      expect(screen.queryByTestId('notification-row-reminder')).toBeNull();
    });
    And('Reminders shows sound on and quiet hours off', async () => {
      const section = await reminders();
      await waitFor(() => expect(section.getByLabelText('Sound and buzz')).toBeChecked());
      expect(section.getByLabelText('Quiet hours')).not.toBeChecked();
    });
  });

  Scenario('mw-ev7oyy.9 AC-4: turning Reminders sound off silences a reminder push and no other class', ({ Given, When, Then, And }) => {
    Given('the Me screen is opened', openMe);
    When('he turns Sound off in Reminders', async () => {
      const section = await reminders();
      await waitFor(() => expect(section.getByLabelText('Sound and buzz')).toBeChecked());
      await userEvent.click(section.getByLabelText('Sound and buzz'));
    });
    Then('a reminder push is shown silent', async () => {
      await waitFor(async () => expect((await pushAt('12:00')).options.silent).toBe(true));
    });
    And('a pushed record of class {string} is still not silent', async (_c, messageClass: string) => {
      const settings = await settingsRepo.getNotificationSettings();
      expect(notificationSpecForClass(messageClass as 'message', 'tx', settings.message).options.silent).toBe(false);
    });
  });

  Scenario('mw-ev7oyy.9 AC-4: quiet hours set on the Me screen silence a reminder push inside them only', ({ Given, When, Then, And }) => {
    Given('the Me screen is opened', openMe);
    When('he turns on quiet hours in Reminders from 22:00 to 07:00', async () => {
      const section = await reminders();
      await waitFor(() => expect(section.getByLabelText('Quiet hours')).not.toBeChecked());
      await userEvent.click(section.getByLabelText('Quiet hours'));
      fireEvent.change(section.getByLabelText('From'), { target: { value: '22:00' } });
      fireEvent.change(section.getByLabelText('To'), { target: { value: '07:00' } });
    });
    Then('a reminder push at 23:30 is shown silent', async () => {
      await waitFor(async () => expect((await pushAt('23:30')).options.silent).toBe(true));
    });
    And('a reminder push at 12:00 is shown with sound', async () => {
      expect((await pushAt('12:00')).options.silent).toBe(false);
    });
  });

  Scenario('mw-ev7oyy.9 AC-4: Reset to defaults on the Notifications rows leaves Reminders as he set it', ({ Given, When, Then, And }) => {
    Given('the Me screen is opened', openMe);
    When('he turns Sound off in Reminders', async () => {
      const section = await reminders();
      await waitFor(() => expect(section.getByLabelText('Sound and buzz')).toBeChecked());
      await userEvent.click(section.getByLabelText('Sound and buzz'));
    });
    And('he taps {string} on the Notifications rows', async (_c, label: string) => {
      await userEvent.click(within(await screen.findByRole('region', { name: 'Notifications' })).getByRole('button', { name: label }));
    });
    Then('Reminders shows sound off', async () => {
      expect((await reminders()).getByLabelText('Sound and buzz')).not.toBeChecked();
      expect((await settingsRepo.getReminderSettings()).sound).toBe(false);
    });
  });
});

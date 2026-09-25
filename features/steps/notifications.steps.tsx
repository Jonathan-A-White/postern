// features/steps/notifications.steps.tsx — runs features/notifications.feature
// under vitest via @amiceli/vitest-cucumber. Renders the real settings screen
// and, for the "a pushed record..." steps, calls notificationSpecForClass with
// whatever settingsRepo now holds — the same read src/sw.ts's push handler does.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NotificationSettingsScreen } from '../../src/settings';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { notificationSpecForClass } from '../../src/push/classOptions';
import type { MessageClass } from '../../src/data/db';

interface RowState {
  sound: boolean;
  vibrate: boolean;
  stayUntilDismissed: boolean;
  quiet: boolean;
}

async function freshScreen(): Promise<void> {
  cleanup();
  await db.settings.clear();
}

async function renderScreen(): Promise<void> {
  render(<NotificationSettingsScreen />);
  await screen.findByTestId('notification-row-message');
}

async function expectRowState(messageClass: MessageClass, expected: RowState): Promise<void> {
  const row = within(await screen.findByTestId(`notification-row-${messageClass}`));
  expect((row.getByLabelText('Sound') as HTMLInputElement).checked).toBe(expected.sound);
  expect((row.getByLabelText('Vibrate') as HTMLInputElement).checked).toBe(expected.vibrate);
  expect((row.getByLabelText('Stay until dismissed') as HTMLInputElement).checked).toBe(expected.stayUntilDismissed);
  expect((row.getByLabelText('Quiet') as HTMLInputElement).checked).toBe(expected.quiet);
}

async function toggleSwitch(messageClass: MessageClass, label: string): Promise<void> {
  const row = within(await screen.findByTestId(`notification-row-${messageClass}`));
  await userEvent.click(row.getByLabelText(label));
}

const feature = await loadFeature('features/notifications.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: the settings screen preloads the decided defaults for every class', ({ Given, Then, And }) => {
    Given('the notification settings screen is opened for the first time', async () => {
      await freshScreen();
      await renderScreen();
    });

    Then('"decision-needed" shows sound on, vibrate on, stay until dismissed on, and quiet off', async () => {
      await expectRowState('decision-needed', { sound: true, vibrate: true, stayUntilDismissed: true, quiet: false });
    });

    And('"landing" shows sound on, vibrate off, stay until dismissed off, and quiet off', async () => {
      await expectRowState('landing', { sound: true, vibrate: false, stayUntilDismissed: false, quiet: false });
    });

    And('"alarm" shows sound on, vibrate on, stay until dismissed on, and quiet off', async () => {
      await expectRowState('alarm', { sound: true, vibrate: true, stayUntilDismissed: true, quiet: false });
    });

    And('"message" shows sound on, vibrate on, stay until dismissed off, and quiet off', async () => {
      await expectRowState('message', { sound: true, vibrate: true, stayUntilDismissed: false, quiet: false });
    });
  });

  Scenario("AC-2: a changed setting changes that class's notifications only", ({ Given, When, Then, And }) => {
    Given('the notification settings screen is opened', async () => {
      await freshScreen();
      await renderScreen();
    });

    When('vibrate is turned off for "message"', async () => {
      await toggleSwitch('message', 'Vibrate');
    });

    Then('a pushed record of class "message" has no vibrate pattern', async () => {
      const settings = await settingsRepo.getNotificationSettings();
      const spec = notificationSpecForClass('message', 'tx1', settings.message);
      expect(spec.options.vibrate).toBeUndefined();
    });

    And('a pushed record of class "alarm" still has its vibrate pattern', async () => {
      const settings = await settingsRepo.getNotificationSettings();
      const spec = notificationSpecForClass('alarm', 'tx1', settings.alarm);
      expect(spec.options.vibrate).toBeDefined();
    });
  });

  Scenario("AC-3: reset to defaults restores every class's decided settings", ({ Given, And, When, Then }) => {
    Given('the notification settings screen is opened', async () => {
      await freshScreen();
      await renderScreen();
    });

    And('vibrate is turned off for "message"', async () => {
      await toggleSwitch('message', 'Vibrate');
    });

    When('"Reset to defaults" is tapped', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    });

    Then('"message" shows sound on, vibrate on, stay until dismissed off, and quiet off', async () => {
      await expectRowState('message', { sound: true, vibrate: true, stayUntilDismissed: false, quiet: false });
    });

    And('a pushed record of class "message" has its vibrate pattern back', async () => {
      const settings = await settingsRepo.getNotificationSettings();
      const spec = notificationSpecForClass('message', 'tx1', settings.message);
      expect(spec.options.vibrate).toBeDefined();
    });
  });
});

afterAll(() => {
  cleanup();
});

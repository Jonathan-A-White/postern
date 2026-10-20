// features/steps/talk-settings.steps.tsx — runs features/talk-settings.feature (mw-06ggew.6): the real Me screen's Talk
// section, and the real compose bar beside it reading what he chooses. The browser's speech recogniser is a bare fake
// (the bar only needs one to exist); nothing is sent.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Composer } from '../../src/cockpit/Composer';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { readTalkSettings } from '../../src/cockpit/talkSettings';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

class FakeRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  start() {}
  stop() {}
  abort() {}
}

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/talk-settings.feature');

const talkSection = () => screen.getByRole('region', { name: 'Talk' });
const choice = (group: string, name: string) => within(within(talkSection()).getByRole('radiogroup', { name: group })).getByRole('radio', { name });

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(() => {
    cleanup();
    localStorage.clear();
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognizer;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => (isChallengeRequest(String(url)) ? challengeResponse() : new Response('404 page not found', { status: 404 }))),
    );
  });

  const openMe = () => {
    render(<MeScreen />);
  };

  Scenario('AC-1: Me has a Talk section with Talk (Hold or Tap) and Send (On release or By button), Hold and On release to begin with', ({ Given, Then, And }) => {
    Given('the Me screen is open', openMe);
    Then('the Talk section offers {string}: {string} and {string}', (_c, group: string, first: string, second: string) => {
      expect(choice(group, first)).toBeInTheDocument();
      expect(choice(group, second)).toBeInTheDocument();
    });
    And('the Talk section offers {string}: {string} and {string}', (_c, group: string, first: string, second: string) => {
      expect(choice(group, first)).toBeInTheDocument();
      expect(choice(group, second)).toBeInTheDocument();
    });
    And('{string} is chosen for {string} and {string} is chosen for {string}', (_c, a: string, groupA: string, b: string, groupB: string) => {
      expect(choice(groupA, a)).toBeChecked();
      expect(choice(groupB, b)).toBeChecked();
    });
  });

  Scenario('AC-1: choosing Tap and By button changes the compose bar at once, with no reload', ({ Given, When, And, Then }) => {
    Given('the Me screen is open beside the compose bar with its bar out', async () => {
      render(
        <>
          <MeScreen />
          <Composer thread={{ bead: 'mw-talk.1' }} />
        </>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
      await waitFor(() => expect(screen.getByText(/^Hold the bar and speak\. Slide off it/)).toBeInTheDocument());
    });
    When('he chooses {string} for {string}', (_c, name: string, group: string) => {
      act(() => choice(group, name).click());
    });
    And('he chooses {string} for {string}', (_c, name: string, group: string) => {
      act(() => choice(group, name).click());
    });
    Then('the compose bar says it can be tapped to keep the mic on and that the words wait in the box', async () => {
      await waitFor(() => expect(screen.getByText(/tap it to keep the mic on and tap again to stop\. The words wait in the box/)).toBeInTheDocument());
    });
    And('the choices are kept on the device', () => {
      expect(readTalkSettings()).toEqual({ talk: 'tap', send: 'button' });
    });
  });

  Scenario('AC-1: a choice kept before is chosen when Me opens again', ({ Given, When, Then }) => {
    Given('{string} and {string} were kept on the device', (_c, talk: string, send: string) => {
      localStorage.setItem('postern.talk', JSON.stringify({ talk: talk.toLowerCase(), send: send === 'By button' ? 'button' : 'release' }));
    });
    When('the Me screen is open', openMe);
    Then('{string} is chosen for {string} and {string} is chosen for {string}', (_c, a: string, groupA: string, b: string, groupB: string) => {
      expect(choice(groupA, a)).toBeChecked();
      expect(choice(groupB, b)).toBeChecked();
    });
  });
});

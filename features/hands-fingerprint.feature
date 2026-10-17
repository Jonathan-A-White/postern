Feature: On a passkey phone his fingerprint approves a step for his hands (mw-ev7oyy.41)

  Scenario: mw-ev7oyy.41 AC-1: one tap on Approve and run asks for the fingerprint, and a good one sends the signed approval
    Given a passkey-wrapped key, unlocked, and a step for his hands not yet run
    When "Approve and run" is tapped
    Then the fingerprint is asked for once and there is no "Confirm and run" box
    And a run action for the step is delivered, signed by his key

  Scenario: mw-ev7oyy.41 AC-2: a cancelled fingerprint sends nothing and says so on the step
    Given a passkey-wrapped key, unlocked, and a step for his hands not yet run
    And the fingerprint will be cancelled
    When "Approve and run" is tapped
    Then nothing is delivered
    And the step says "Fingerprint cancelled. Nothing was sent."
    And the step still offers "Approve and run"

  Scenario: mw-ev7oyy.41 AC-3: a phrase-wrapped key still shows the Confirm and run box
    Given a phrase-wrapped key, unlocked, and a step for his hands not yet run
    When "Approve and run" is tapped
    Then the step offers "Confirm and run" and nothing is delivered yet
    And tapping "Confirm and run" delivers a run action for the step

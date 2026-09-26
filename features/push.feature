Feature: Classified push notifications

  Scenario: AC-1: decision-needed vibrates and stays until dismissed
    Given a pushed record of class "decision-needed"
    Then the notification vibrates and requires interaction to dismiss

  Scenario: AC-2: landing is a normal alert whose repeats replace each other
    Given a pushed record of class "landing"
    Then the notification is tagged "landing" so a repeat replaces it

  Scenario: AC-3: alarm is loud, insistent, and re-alerts on repeat
    Given a pushed record of class "alarm"
    Then the notification vibrates, requires interaction, and renotifies on repeat

  Scenario: AC-4: message is a quiet, watch-friendly buzz
    Given a pushed record of class "message"
    Then the notification is a soft buzz that does not require interaction

  Scenario: AC-5: subscribing posts the subscription
    Given notification permission will be granted
    When this phone subscribes to push
    Then the backend's VAPID key is fetched
    And the subscription is posted with this phone's public key

  Scenario: AC-6: a denied permission does not subscribe
    Given notification permission will be denied
    When this phone subscribes to push
    Then no subscription is posted

  Scenario: mw-f758y.22.2 AC1: subscribing with an unlocked key signs the challenge on every call
    Given notification permission will be granted and a key is unlocked
    When this phone subscribes to push
    Then both calls carried a signed proof of the unlocked key

  Scenario: mw-f758y.22.2 AC2: a 401 while subscribing shows "Licence required"
    Given notification permission will be granted and a key is unlocked
    And the backend answers every proved call with 401
    When this phone subscribes to push
    Then subscribing fails with "Licence required"

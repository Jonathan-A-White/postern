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

Feature: A relaunch that races the unlock's write meets the key, not the door (mw-6ww.175.60)

  Scenario: mw-6ww.175.60 AC-1: the app rebuilt while the unlock is still being kept shows the door only until the write ends
    Given the unlock's wrapping is held
    And he unlocks with his key
    When the app is rebuilt from the stored session
    Then the launch has not answered yet
    When the wrapping is let go
    Then the launch finds his key and not the door

  Scenario: mw-6ww.175.60 AC-1b: a lock while the unlock is still being kept leaves no session behind
    Given the unlock's wrapping is held
    And he unlocks with his key
    When he locks
    And the wrapping is let go
    And the app is rebuilt from the stored session
    Then the launch shows the door

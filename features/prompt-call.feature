Feature: The composer offers the saved prompts as he types and checks a call before Send (mw-nqur1n.5)

  Scenario: mw-nqur1n.5: typing a slash lists the prompts with their summaries and signatures
    Given the backend has the prompts "top5" and "sweep"
    When he types "/" in the composer
    Then the list offers "/sweep" and "/top5"
    And the list shows "The five things that matter" and the chip "--duration 30m"

  Scenario: mw-nqur1n.5: choosing a prompt from the list fills in its name and keeps the cursor in the box
    Given the backend has the prompts "top5" and "sweep"
    When he types "/to" in the composer
    And he chooses "/top5" from the list
    Then the composer holds "/top5 "
    And the box has the cursor

  Scenario: mw-nqur1n.5: a good call enables Send and goes out as the text he typed
    Given the backend has the prompts "top5" and "sweep"
    When he types "/top5 --duration 15m" in the composer
    Then Send is enabled and no error shows
    When he taps Send
    Then the message "/top5 --duration 15m" is sent

  Scenario: mw-nqur1n.5: an unknown prompt shows its name and keeps Send disabled
    Given the backend has the prompts "top5" and "sweep"
    When he types "/top6" in the composer
    Then the error "Unknown prompt /top6" shows
    And Send is disabled

  Scenario: mw-nqur1n.5: a bad option value shows what it wants and keeps Send disabled
    Given the backend has the prompts "top5" and "sweep"
    When he types "/top5 --duration soon" in the composer
    Then the error "--duration wants a duration like 30m" shows
    And Send is disabled

  Scenario: mw-nqur1n.5: a message not beginning with a slash is untouched
    Given the backend has the prompts "top5" and "sweep"
    When he types "see /top6 later" in the composer
    Then no list and no error show
    And Send is enabled and no error shows
    When he taps Send
    Then the message "see /top6 later" is sent

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

  Scenario: mw-nqur1n.16: a half-typed option is not an error and the rest of it shows in grey
    Given the backend has the prompts "top5" and "sweep"
    When he types "/top5 --" in the composer
    Then no error shows
    And the grey text "--duration" shows after the cursor

  Scenario: mw-nqur1n.16: tapping the grey option, then the grey default, builds the call
    Given the backend has the prompts "top5" and "sweep"
    When he types "/top5 --" in the composer
    And he taps the grey text "--duration"
    Then the composer holds "/top5 --duration "
    And the grey text "30m" shows after the cursor
    When he taps the grey text "30m"
    Then the box reads "/top5 --duration 30m"
    And Send is enabled and no error shows

  Scenario: mw-nqur1n.16: the Tab key takes the grey text and the box keeps the cursor
    Given the backend has the prompts "top5" and "sweep"
    When he types "/top5 --du" in the composer
    And he presses Tab
    Then the composer holds "/top5 --duration "
    And the box has the cursor

  Scenario: mw-nqur1n.16: a complete unknown option is still an error and nothing is suggested
    Given the backend has the prompts "top5" and "sweep"
    When he types "/top5 --nope " in the composer
    Then the error "/top5 has no option --nope" shows
    And no grey text shows

  Scenario: mw-gq6.236: free words after the name are the text option, so a /later call can be sent
    Given the backend has the prompts "top5", "sweep" and "later"
    When he types "/later a licence for Luke" in the composer
    Then Send is enabled and no error shows
    When he taps Send
    Then the message "/later a licence for Luke" is sent

  Scenario: mw-gq6.236: a prompt without a text option still refuses stray words
    Given the backend has the prompts "top5", "sweep" and "later"
    When he types "/top5 a licence" in the composer
    Then the error "Expected an option like --duration" shows
    And Send is disabled

  Scenario: mw-gq6.236: a text option wanted and left out says what to type
    Given the backend has the prompts "top5", "sweep" and "later"
    When he types "/later " in the composer
    Then the error "/later needs some words" shows
    And Send is disabled

  Scenario: mw-ek5q5j.1: apostrophes in the words of a /later call are letters, so it goes
    Given the backend has the prompts "top5", "sweep" and "later"
    When he types "/later I'm sure it's Luke's" in the composer
    Then Send is enabled and no error shows
    When he taps Send
    Then the message "/later I'm sure it's Luke's" is sent

  Scenario: mw-ek5q5j.1: a failed check shows its warning with Send grey, and a short tap sends nothing
    Given the backend has the prompts "top5", "sweep" and "later"
    When he types "/nosuchprompt hello" in the composer
    Then the error "Unknown prompt /nosuchprompt" shows
    And Send is disabled
    And Send is labelled "Send (hold to send anyway)"
    When he taps the grey Send
    Then nothing is sent

  Scenario: mw-ek5q5j.1: holding the grey Send for 600 ms sends the text exactly as typed
    Given the backend has the prompts "top5", "sweep" and "later"
    When he types "/nosuchprompt hello" in the composer
    Then the error "Unknown prompt /nosuchprompt" shows
    When he holds the grey Send for 650 ms
    Then the message "/nosuchprompt hello" is sent
    And the composer box is empty

  Scenario: mw-ek5q5j.1: letting go of the grey Send before 600 ms sends nothing
    Given the backend has the prompts "top5", "sweep" and "later"
    When he types "/nosuchprompt hello" in the composer
    And he holds the grey Send for 300 ms
    Then nothing is sent

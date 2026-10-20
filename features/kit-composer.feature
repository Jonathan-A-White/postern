Feature: Postern's compose bar is voice-kit's Composer with Postern's settings (mw-06ggew.5)

  Scenario: AC-1: a channel's compose bar is the kit's Composer, opening on the box with attach, camera and the mic in place of Send
    Given a channel's composer is open
    Then the compose bar is drawn by the kit
    And it shows "Attach files", "Take a photo" and "Speak a message"
    And there is no Send button yet

  Scenario: AC-2: a file waiting to go that is not a picture opens on a tap of its name
    Given a channel's composer is open
    When he attaches "notes.pdf" of type "application/pdf" with Attach files
    And he taps "Open notes.pdf"
    Then the browser opens the file in a new tab

  Scenario: AC-2: a quote with no words goes on Send, the quote at the top of the message
    Given a channel's composer is open with a quote of "Ship it today" by "Mayor"
    When he taps Send
    Then one message is sent to the channel beginning "> Ship it today"
    And the quote is cleared

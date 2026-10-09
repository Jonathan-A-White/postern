Feature: A channel's Hold to talk hears him as the Talk line's does, on bsv-kit's honest microphone (mw-it6qk5.4)

  Scenario: AC-1: a channel's Hold to talk on the honest microphone hears the clip and sends its words, with no capture of the page's own beside the recogniser (mw-f7gmps.2)
    Given the phone's microphone is bsv-kit's honest one, hearing "Please read me the first chapter"
    And a channel's composer is open
    When he taps the mic beside Send
    And he presses and holds the bar until the recogniser has heard the whole clip
    Then the live transcript reads "Please read me the first chapter"
    And the page holds no microphone capture and has made no voice recorder
    When he lets go of the bar
    Then one message is delivered with the words "Please read me the first chapter"

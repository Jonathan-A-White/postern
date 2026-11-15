Feature: A Talk turn can come from words with no hold of the button, and is the same turn a hold sends (mw-deiheir.3)

  The Talk line's words group (begin, heard, send, cancel) opens a turn through the line's own hold event without opening
  the microphone, shows the words so far where a hold's live transcript shows, and sends them through the line's own release
  event. The turn is the same record a hold of the same words sends, and the Mayor's answer is spoken as it always is.

  Scenario: mw-deiheir.3 AC-1: a turn begun, heard and sent from words is the turn a hold of the same words sends
    Given the Talk line is open on the phone's honest microphone, which hears "what is in flight"
    When a turn is begun from words
    And the words "what is in flight" are heard
    Then the live transcript reads "what is in flight"
    And no microphone has been opened
    When the words "what is in flight" are sent
    Then one turn is sent with the words "what is in flight"
    And the status reads "Sent."
    When the Mayor answers "Three things are in flight."
    Then the answer is spoken
    When the answer has been spoken to its end
    And he holds the talk button until the microphone has heard "what is in flight", and lets go
    Then a second turn is sent
    And the two turns are the same record, apart from their number

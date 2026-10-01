Feature: Several files sent together are one post (mw-909ci.3)

  Scenario: mw-6ww.51: two images sent together are one message with attachments and one bubble showing both
    Given two images and the caption "the two screens"
    When they are sent together to the general thread
    Then one message was delivered
    And its plaintext has "attachments" with both hashes in order and the caption as its text
    And the conversation shows one message holding two images

  Scenario: one image is sent exactly as before
    Given one image and the caption "the one screen"
    When they are sent together to the general thread
    Then one message was delivered
    And its plaintext has "attachment" and no "attachments"

  Scenario: a failed upload of the second file sends nothing yet, and a later try uploads only that file
    Given two images and the caption "the two screens"
    And the second upload fails
    When they are sent together to the general thread
    Then the message waits in the outbox for another try
    And no message was delivered
    When the sender tries again
    Then only the second file is uploaded again and one message is delivered

  Scenario: a message whose attachments array holds a malformed entry reads as plain text
    Given a received message whose attachments array holds a good entry and a malformed one
    Then it reads as plain text
    And the conversation shows no image

  Scenario: the Talk list preview of a two-image post reads 2 images · <caption>
    Given a received post of two images with the caption "the two screens"
    When Talk opens
    Then the Factory row previews "2 images · the two screens"

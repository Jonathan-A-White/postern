Feature: General groups a reply under the message it names, one level deep (mw-hkg17.1)

  Scenario: mw-hkg17.1: a General message whose re names another General message is a reply in that message's thread
    Given a General message "the post"
    And a General message "an answer" whose re names "the post"
    And a General message "an answer to the answer" whose re names the reply "an answer"
    And a General message "unrelated"
    When General is grouped into threads
    Then the threads are rooted at "the post" and "unrelated" in that order
    And "the post" has the replies "an answer" and "an answer to the answer"
    And "unrelated" has no replies

  Scenario: mw-hkg17.1: a transcript or an unknown re is not a reply
    Given a voice note in General
    And a transcript whose re names the voice note
    And a General message "lost" whose re names a message that is not there
    When General is grouped into threads
    Then the voice note has no replies
    And "lost" is a thread root with no replies

Feature: A channel never says it is empty before the phone has read it, and says plainly when it could not (mw-gq6.898)

  Scenario: mw-gq6.898 AC1: an empty channel reads Reading while the phone's own read is held back
    Given the phone holds nothing in the channel "quiet" and the backend has answered
    And the phone is slow to read one channel's posts
    When the channel "quiet" is opened
    Then "Reading this channel…" is shown and "Nothing said here yet" is never shown until the phone has read it
    And "Nothing said here yet" is then shown

  Scenario: mw-gq6.898 AC1: an empty channel reads Reading until the first sync has answered
    Given the phone holds nothing in the channel "quiet" and the backend has not answered yet
    When the channel "quiet" is opened
    Then "Reading this channel…" is shown and "Nothing said here yet" is not
    When the backend answers
    Then it then reads "Nothing said here yet" and not "Reading this channel…"

  Scenario: mw-gq6.898 AC1: an empty channel says plainly that the backend could not be reached
    Given the phone holds nothing in the channel "quiet" and the first sync has failed
    When the channel "quiet" is opened
    Then "Can't reach the Mayor yet" is shown and "Nothing said here yet" is not
    When the backend answers
    Then it then reads "Nothing said here yet" and not "Can't reach the Mayor yet"

  Scenario: mw-gq6.898 AC1: the posts arrive when the sync answers and replace the Reading line
    Given the phone holds nothing in the channel "quiet" and the backend has not answered yet
    When the channel "quiet" is opened
    And the sync brings the post "Q1 arrived" and the backend answers
    Then it then reads "Q1 arrived" and not "Reading this channel…"

  Scenario: mw-gq6.898 AC1: a reply thread whose post is not held yet reads Reading, not that the post is missing
    Given the phone holds nothing in the channel "quiet" and the backend has not answered yet
    When the reply thread of a post in the channel "quiet" is opened
    Then "Reading this channel…" is shown and "That post is not on this phone" is not

  Scenario: mw-gq6.910: a prompt channel with no such prompt reads Reading until the first sync has answered
    Given the phone holds the prompt list "sweep" and nothing in the channel "prompt:top5" and the backend has not answered yet
    When the channel "prompt:top5" is opened
    Then "Reading this channel…" is shown and "Nothing said here yet" is not
    When the backend answers
    Then it then reads "Nothing said here yet" and not "Reading this channel…"

  Scenario: mw-gq6.910: a prompt channel with no such prompt says plainly that the backend could not be reached
    Given the phone holds the prompt list "sweep" and nothing in the channel "prompt:top5" and the first sync has failed
    When the channel "prompt:top5" is opened
    Then "Can't reach the Mayor yet" is shown and "Nothing said here yet" is not
    When the backend answers
    Then it then reads "Nothing said here yet" and not "Can't reach the Mayor yet"

  Scenario: mw-gq6.910: a prompt channel with no such prompt and a read that answered shows the empty line as before
    Given the phone holds the prompt list "sweep" and nothing in the channel "prompt:top5" and the backend has answered
    When the channel "prompt:top5" is opened
    Then "Nothing said here yet" is shown once the phone has read it

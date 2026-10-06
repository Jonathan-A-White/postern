Feature: Opening a channel does not re-download every attachment (mw-gq6.284)

  Scenario: AC-1: a conversation with 20 attachments of which 3 are near the viewport fetches 3 blobs
    Given a conversation of 20 attachments, each its own file
    When it is shown and 3 of the attachments are near the viewport
    Then 3 blobs were fetched from the backend

  Scenario: AC-2: re-opening a conversation after a reload fetches no blob from the network
    Given a conversation of 3 attachments, each its own file
    And it was shown and all its images loaded
    When the page is loaded again and the conversation is shown
    Then all its images show again
    And no blob was fetched from the backend since the reload

  Scenario: AC-3: two attachments with the same hash shown at once make one fetch
    Given a conversation of two attachments that are the same file
    When it is shown
    Then both images show
    And 1 blob was fetched from the backend

  Scenario: AC-4: with 10 blob requests queued never more than 4 are in flight and each challenge is fetched when its request leaves the queue
    Given 10 attachments on the backend, which answers only when told to
    When all 10 are asked for at once
    Then 4 blobs are in flight and 4 challenges have been fetched
    When the backend answers them one at a time
    Then no more than 4 blobs were ever in flight
    And no challenge was fetched before its request left the queue
    And all 10 attachments opened

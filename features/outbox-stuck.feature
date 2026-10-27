Feature: Rows an older build left stuck go once the fix arrives, and a row that keeps failing says why (mw-o14xubc)

  Scenario: AC-6: a phone with rows queued under 0.8.55, 0.8.56 and 0.8.57 updates to the fix, comes back Live, and every row is posted within one retry without a reload or discard
    Given the phone holds a camera picture queued under 0.8.55 whose upload his weak signal could not finish in the 30 s the old builds allowed, and typed messages queued behind it under 0.8.56 and 0.8.57
    And the phone updates to the fix and the backend answers everything it is given
    When the stream opens and the phone reads Live
    Then every row is posted to the backend within one retry
    And none went to WhatsOnChain
    And the status line clears

  Scenario: AC-3: while a row fails every try the status line names the reason after the countdown
    Given the phone holds a photo message queued under 0.8.55 whose upload the connection cut on every try, and typed messages queued behind it under 0.8.56 and 0.8.57
    And the phone updates to the fix and the backend answers everything but the upload, which the connection still cuts
    When the stream opens and the phone reads Live
    Then the typed messages are posted to the backend and the photo message is still pending
    And the status line says "Retrying in" and "The connection was cut before the backend answered"

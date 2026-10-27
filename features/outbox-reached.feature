Feature: What he sends goes while the backend answers, though the event stream will not stay up (mw-j4usch0)

  Scenario: AC-5: the stream drops and reconnects in a loop, probes succeed, and his message goes within one retry without a reload
    Given the event stream drops every time it opens and nothing the backend is asked is answered
    And his message "Is the deploy done?" has failed six tries and waits a minute for the next
    Then the status line says "Sending when back online"
    When the backend answers again, the stream still dropping, and he comes back to the app
    Then the probe the return makes is answered
    And his message is posted to the backend within one retry, without a reload
    And it never went to WhatsOnChain
    And the status line clears

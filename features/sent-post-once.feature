Feature: A post he sends shows once at every step (mw-pz7275r)

  Scenario: mw-pz7275r: its own echo arriving before the backend's reply leaves one bubble, not two
    Given the backend sends the record back to the phone before it answers the post
    When he sends "test" in the general thread
    Then the thread showed one bubble before the post, while the record was kept and after the reply
    And the bubble at the end is his own post, no longer pending

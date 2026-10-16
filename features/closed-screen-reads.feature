Feature: A read a screen started that answers after the screen has closed sets nothing (mw-ev7oyy.21)
  A screen that is closed while a read is still on its way drops the answer when it comes. In a test the
  answer can land after the page itself is torn down, where setting state throws 'window is not defined'
  and fails a green run.

  Scenario: AC1: the Key screen closed while the chain is still answering sets nothing afterwards
    Given my key is unlocked and every read the Key screen makes is still on its way
    When the key screen is opened
    And it is closed before the reads answer
    And the page is torn down before the balance read fails and every other read answers
    Then nothing tried to update the closed screen

Feature: A thread row previews a message's Markdown as plain text (mw-hy6f4.6)

  Scenario: mw-hy6f4.6 AC2: a Talk row whose last message is Markdown shows it without the markers
    Given the Mayor's last word in the general thread is "**Landed** `mw-x.1`"
    When Talk opens
    Then the Factory row previews "Landed mw-x.1"

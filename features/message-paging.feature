Feature: The phone drains the backend's messages in pages (mw-xhtcup.4)

  Scenario: mw-xhtcup.4 AC-1: a server answering three pages is drained in one sync, the cursor stored after each page
    Given a backend that holds five messages in three pages
    When the phone syncs its messages once
    Then it asked for each page with limit 200 and the cursor stored so far
    And all five messages are stored once and the cursor is at the end

  Scenario: mw-xhtcup.4 AC-2: a failure on the second page keeps the cursor at the first page and the next sync resumes there
    Given a backend whose second page fails once
    When the phone syncs its messages and the second page fails
    Then the first page's message is stored and the cursor is at the first page's end
    When the phone syncs its messages again
    Then the sync resumes from the first page's end and all messages are stored once

  Scenario: mw-xhtcup.4 AC-3: an older backend that answers without more is read as one page
    Given an older backend that answers one page without more
    When the phone syncs its messages once
    Then only one page was asked for and the cursor is at its end

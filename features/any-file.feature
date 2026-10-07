Feature: Attach files takes any file of any type, each sent with its name (mw-gq6.289)

  Scenario: AC-1: a markdown file and a zip attached together go out as one message, each with its own type and name
    Given the composer is open
    When he attaches "notes.md" of type "text/markdown" and "data.zip" of type "application/zip" with Attach files
    And he taps Send
    Then one message is delivered with two attachments
    And attachment 1 has mime "text/markdown" and name "notes.md"
    And attachment 2 has mime "application/zip" and name "data.zip"

  Scenario: AC-2: a file whose type the phone does not report is sent as application/octet-stream with its name
    Given the composer is open
    When he attaches "Makefile" of no type with Attach files
    And he taps Send
    Then one message is delivered with one attachment
    And attachment 1 has mime "application/octet-stream" and name "Makefile"

  Scenario: AC-2: a file over 8 MiB is still refused
    Given the composer is open
    When he attaches "huge.bin" of 9 MiB with Attach files
    Then he is told "huge.bin is over 8 MB."
    And nothing is waiting to be sent

  Scenario: AC-3: a received file of a type the app does not show is a file chip that downloads on tap
    Given a received message with a file "data.zip" of type "application/zip" and 2048 bytes
    When the conversation is shown
    Then it shows the file "data.zip" with its size "2 KB"
    When he taps the file "data.zip"
    Then the file is downloaded as "data.zip"

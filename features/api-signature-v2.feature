Feature: Every /api request is signed whole (Postern2)
  The app's one door to the backend signs the method, the request target, the
  body's hash and the nonce, so a captured header is good for that one request
  and no other (docs/api.md, Authentication). The event stream is signed the same way.

  Scenario: mw-xhtcup.8 AC1: a message post is signed over its method, target and body
    Given a backend that checks the Postern2 signature of what it receives
    When the app posts a JSON message with his key
    Then the backend verifies the header over exactly that method, target and body

  Scenario: mw-xhtcup.8 AC2: the event stream is signed over a GET with no body
    Given a backend that checks the Postern2 signature of what it receives
    When the app opens the event stream with his key
    Then the backend verifies the header over a GET of the stream with an empty body

  Scenario: mw-xhtcup.8 AC3: a header moved to another body or target is refused
    Given a backend that checks the Postern2 signature of what it receives
    When the app posts a JSON message with his key
    Then the same header is refused for a changed body
    And the same header is refused for a changed target

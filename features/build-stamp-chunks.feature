Feature: An update downloads only the code that changed: the version stamp and the libraries stay out of the main code file (mw-7dige5.3)

  Scenario: AC-1: two builds of the same commit at different times give the same main chunk and the same library chunk
    Given the app is built at one time and again at another time from the same code
    Then the two builds list the same code files in dist/assets
    And the main chunk and the library chunk have the same bytes in both
    But the page that carries the version stamp differs between them

  Scenario: AC-2: the main chunk holds no build time and the libraries sit in a chunk of their own
    Given the app is built at one time and again at another time from the same code
    Then the main chunk does not contain the build time
    And the library chunk holds React and does not import the main chunk
    And the page carries the version stamp before the main chunk loads

  Scenario: AC-3: the heavy lazy libraries stay lazy
    Given the app is built at one time and again at another time from the same code
    Then the page does not preload the mermaid, elk or contract chunks
    And the library chunk does not contain mermaid

Feature: The Roadmap shows the work in four calm lanes (mw-njb33n.3)

  Scenario: mw-njb33n.3 AC1: the lanes count the work by app and a tap opens an app to its titles
    Given a view with open work across two apps at several priorities
    When the Roadmap is drawn
    Then the Now lane counts 3 and shows one row for "lampas" with its top title
    And the Next, Later and Icebox lanes count 1, 1 and 1
    When he taps the "lampas" row in Now
    Then its titles show, each a link to its bead

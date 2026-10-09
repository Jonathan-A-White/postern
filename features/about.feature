Feature: About opens with the shoulders-of-giants line and credits every source we build on (mw-vtjxh4.3)

  Scenario: AC-1: the Me screen links to About, and the link opens it
    When the Me screen is opened
    Then it has a link "About and credits" to the About screen

  Scenario: AC-1: About opens with Newton's line, attributed, and one sentence on why we credit
    When the About screen is opened
    Then its first words are Newton's "If I have seen further it is by standing on the shoulders of Giants."
    And the line is attributed to Isaac Newton, in his letter to Robert Hooke, 1675
    And one sentence follows on why we credit

  Scenario: AC-1: every credit names itself as a link, says what it is used for, links its licence and says what was changed
    When the About screen is opened
    Then every credit's name is a link, never a raw address
    And every credit says what it is used for and what was changed
    And every credit's licence is a link

  Scenario: AC-1: the sources we name include the services, the ideas and the speech engines
    When the About screen is opened
    Then it credits "WhatsOnChain", "Beads", "Gas Town", "Claude Code" and "Web Speech API"
    And it says plainly that Postern ships no font or icon library

  Scenario: AC-2: a runtime dependency missing from the credits is found
    Given a package.json dependency "left-pad-9000" that no credit covers
    Then the check for uncredited dependencies names "left-pad-9000"

  Scenario: AC-2: every runtime dependency in package.json and go.mod is credited today
    Given the dependencies in package.json and the modules in server/go.mod
    Then none of them goes uncredited

  Scenario: AC-3: the README's Credits section lists the same credits
    Given the README
    Then its Credits section names every credit shown on About

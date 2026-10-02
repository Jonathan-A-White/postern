Feature: A poisoned precache cannot leave the phone unstyled (mw-j0f2d.41)

  Scenario: mw-j0f2d.41 AC-1: a precached stylesheet that is the app page is deleted and fetched again when the worker activates
    Given the phone's precache holds a stylesheet that is really the app page
    When the worker activates
    Then the stylesheet in the precache is text/css fetched from the network

  Scenario: mw-j0f2d.41 AC-1b: a precached stylesheet that is text/css is kept when the worker activates
    Given the phone's precache holds a stylesheet that is text/css
    When the worker activates
    Then the network was not asked for it

  Scenario: mw-j0f2d.41 AC-2: a request for a stylesheet whose cached copy is the app page goes to the network
    Given the phone's precache holds a stylesheet that is really the app page
    When the page asks for the stylesheet
    Then it gets text/css from the network

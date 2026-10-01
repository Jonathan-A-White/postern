Feature: Each build has its own version, so he can tell on his phone which build has loaded (mw-gq6.196)

  Scenario: AC-1: the Me screen's last line is Postern v, the version, the build time and the commit
    When the Me screen is opened
    Then its last line reads "Postern v" then the version, the UTC build time and the short commit

  Scenario: AC-2: the gate shows the same version
    When the gate is opened
    Then it shows "v" then the same version

  Scenario: AC-3: a build outside a git checkout still has a version and names its commit dev
    Given a folder that is not a git checkout
    When the build asks for its short commit there
    Then the commit is "dev"
    And the version string ends with "dev"

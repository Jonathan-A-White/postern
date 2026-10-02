Feature: Each build has its own version, so he can tell on his phone which build has loaded (mw-gq6.196)

  Scenario: AC-1: the Me screen's first line under its heading is Build, the build time and the commit, then the version smaller (mw-yxwtth.1)
    When the Me screen is opened
    Then its first line reads "Build " then the UTC build time, a dot and the short commit
    And the package version follows it, smaller

  Scenario: AC-2: the gate shows the same version
    When the gate is opened
    Then it shows "v" then the same version

  Scenario: AC-3: a build outside a git checkout still has a version and names its commit dev
    Given a folder that is not a git checkout
    When the build asks for its short commit there
    Then the commit is "dev"
    And the version string ends with "dev"

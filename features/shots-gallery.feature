Feature: The published shots carry a gallery and a manifest, so another team can match Postern's look (mw-s6387p.1)

  Scenario: AC-1: the manifest names every png with its screen, size and address
    Given the png names "390x844/gate.png", "360x640/gate.png" and "1280x800/gate.png"
    When the manifest is built for version "0.5.35" and commit "abc1234"
    Then it lists three files, each with its name, screen, width, height and url
    And the 360x640 file reads screen "gate", width 360, height 640
    And its url is the raw.githubusercontent.com address under shots/latest/

  Scenario: AC-1: the gallery names each screen once with its three sizes side by side
    Given the png names "390x844/gate.png", "360x640/gate.png", "1280x800/gate.png", "390x844/about.png", "360x640/about.png" and "1280x800/about.png"
    When the gallery page is built
    Then each screen appears once, in name order
    And each screen shows its three sizes, each linking to the full png

  Scenario: AC-1: a screen name with markup in it cannot break the gallery
    Given the png names "390x844/a<b>&c.png"
    When the gallery page is built
    Then the page holds the name escaped and no raw tag from it

  Scenario: AC-7: a publish that changed no file adds no commit
    Given the shots branch already holds the same latest/ set
    When the publish asks whether to commit
    Then it skips and nothing is pushed

  Scenario: AC-7: a publish that changed a file adds one commit
    Given the shots branch holds an older latest/ set
    When the publish asks whether to commit
    Then it commits

  Scenario: AC-1: a spec the branch changed is run again at the two other sizes (mw-pb8otc)
    Given a branch that changed the e2e spec "tests/e2e/bottom-bar.spec.ts" and the source file "src/App.tsx"
    When the gate plans its extra shots runs
    Then it runs only that spec, once at 360x640 and once at 1280x800

  Scenario: AC-2: a branch that changed no e2e spec adds no run (mw-pb8otc)
    Given a branch that changed only the source file "src/App.tsx"
    When the gate plans its extra shots runs
    Then it plans no run and says that no e2e spec changed

Feature: The Verified button sits under HOW TO CHECK IT in the story's channel (mw-581qad.2)

  Scenario: mw-581qad.2: the button sits under the newest post carrying HOW TO CHECK IT
    Given a landed story whose channel holds a Builder comment and a later Mayor post, both carrying HOW TO CHECK IT
    When he opens the bead page
    Then exactly one Verified button sits in the conversation, under the Mayor's post

  Scenario: mw-581qad.2: a story with no verify need has no button in the conversation
    Given a story with no verify need whose channel holds a post carrying HOW TO CHECK IT
    When he opens the bead page
    Then no Verified button sits in the conversation

  Scenario: mw-581qad.2: a verify need and no post carrying the marker leaves only the Actions row
    Given a landed story with a verify need whose channel holds no post carrying HOW TO CHECK IT
    When he opens the bead page
    Then no Verified button sits in the conversation
    And the Actions row still offers Verified

  Scenario: mw-581qad.2: tapping Yes, verified under the post sends one message and kills the Actions row's button
    Given a landed story whose channel holds a Builder comment and a later Mayor post, both carrying HOW TO CHECK IT
    When he opens the bead page
    And he taps Verified under the Mayor's post and then Yes, verified
    Then one message to the channel of that bead says "VERIFIED (tapped Verified under HOW TO CHECK IT in mw-gq6.130's channel)"
    And no Verified button is left on the page

  Scenario: mw-581qad.2: once the story is verified the button under the post is gone
    Given a landed story whose channel holds a Builder comment and a later Mayor post, both carrying HOW TO CHECK IT
    And he has already answered that verify need
    When he opens the bead page
    Then no Verified button sits in the conversation

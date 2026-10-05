Feature: A reply that arrives both direct and on chain is one message (mw-f758y.40)

  Scenario: mw-f758y.40 AC-1: the direct reply and its chain copy leave one row, the direct one
    Given the Mayor answered a chain-borne post, and the answer is on the backend and on the chain
    When the phone syncs the backend and then reads the chain
    Then the phone holds one message row, the direct one, on the bead

  Scenario: mw-f758y.40 AC-2: the conversation shows one bubble for the pair
    Given the Mayor answered a chain-borne post, and the answer is on the backend and on the chain
    When the phone reads the chain and then syncs the backend
    Then the bead's conversation shows the answer once

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseXml, XmlError, fieldOf, findFirst, isBlock } from "./xml";
import { importDbotXml, DbotImportError } from "./dbot";

// A cut-down but structurally faithful DBot file, in the older `trade` layout.
const LEGACY = `<xml xmlns="http://www.w3.org/1999/xhtml" is_dbot="true">
  <variables><variable type="" id="a">Initial Stake</variable></variables>
  <block type="trade" id="t1" x="0" y="0">
    <field name="MARKET_LIST">synthetic_index</field>
    <field name="SUBMARKET_LIST">random_index</field>
    <field name="SYMBOL_LIST">R_10</field>
    <field name="TRADETYPECAT_LIST">callput</field>
    <field name="TRADETYPE_LIST">callput</field>
    <field name="TYPE_LIST">both</field>
    <statement name="INITIALIZATION">
      <block type="variables_set">
        <field name="VAR" id="a">Initial Stake</field>
        <value name="VALUE"><block type="math_number"><field name="NUM">0.35</field></block></value>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="tradeOptions">
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="CURRENCY_LIST">USD</field>
        <value name="DURATION">
          <shadow type="math_number"><field name="NUM">5</field></shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number"><field name="NUM">1</field></shadow>
          <block type="variables_get"><field name="VAR" id="a">Initial Stake</field></block>
        </value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" x="0" y="500">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase"><field name="PURCHASE_LIST">CALL</field></block>
    </statement>
  </block>
  <block type="after_purchase" x="0" y="900">
    <statement name="AFTERPURCHASE_STACK">
      <block type="variables_set">
        <field name="VAR" id="a">Initial Stake</field>
        <value name="VALUE">
          <block type="math_arithmetic">
            <field name="OP">MULTIPLY</field>
            <value name="A"><block type="variables_get"><field name="VAR" id="a">Initial Stake</field></block></value>
            <value name="B"><block type="math_number"><field name="NUM">2</field></block></value>
          </block>
        </value>
      </block>
    </statement>
  </block>
</xml>`;

// The newer layout, where fields hang off nested trade_definition_* blocks.
const MODERN = `<xml xmlns="http://www.w3.org/1999/xhtml" is_dbot="true">
  <block type="trade_definition" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SYMBOL_LIST">R_100</field>
        <next>
          <block type="trade_definition_tradetype">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">evenodd</field>
            <next>
              <block type="trade_definition_contracttype">
                <field name="TYPE_LIST">both</field>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>`;

describe("parseXml", () => {
  it("reads elements, attributes and nesting", () => {
    const root = parseXml(`<a x="1"><b>hi</b><c/></a>`);
    const a = root.children[0];
    assert.equal(a.tag, "a");
    assert.equal(a.attrs.x, "1");
    assert.equal(a.children[0].text, "hi");
    assert.equal(a.children[1].tag, "c");
  });

  it("decodes the standard entities", () => {
    const root = parseXml(`<a>a &amp; b &lt;c&gt; &#65;</a>`);
    assert.equal(root.children[0].text, "a & b <c> A");
  });

  // The security properties this parser exists for.
  it("rejects DOCTYPE, which is how XXE gets in", () => {
    assert.throws(
      () => parseXml(`<!DOCTYPE foo [<!ENTITY x "y">]><a/>`),
      (e: Error) => e instanceof XmlError
    );
  });

  it("rejects ENTITY declarations, which is how billion-laughs gets in", () => {
    assert.throws(() => parseXml(`<!ENTITY lol "lol"><a/>`), XmlError);
  });

  it("refuses absurd nesting rather than blowing the stack", () => {
    const deep = "<a>".repeat(500) + "</a>".repeat(500);
    assert.throws(() => parseXml(deep), XmlError);
  });

  it("catches mismatched and unclosed tags", () => {
    assert.throws(() => parseXml(`<a><b></a></b>`), XmlError);
    assert.throws(() => parseXml(`<a><b></b>`), XmlError);
  });

  it("skips comments and CDATA without choking", () => {
    const root = parseXml(`<a><!-- note --><![CDATA[raw < text]]></a>`);
    assert.equal(root.children[0].text, "raw < text");
  });

  it("finds fields on a block", () => {
    const root = parseXml(LEGACY);
    const trade = findFirst(root, (n) => isBlock(n, "trade"));
    assert.equal(fieldOf(trade!, "SYMBOL_LIST"), "R_10");
  });
});

describe("importDbotXml", () => {
  it("imports the legacy `trade` layout", () => {
    const { strategy } = importDbotXml(LEGACY, "Legacy bot");
    assert.equal(strategy.symbol, "R_10");
    assert.equal(strategy.contract.contractType, "CALL");
    assert.equal(strategy.contract.duration, 5);
    assert.equal(strategy.contract.durationUnit, "t");
  });

  it("resolves a stake held in a variable, not the shadow default", () => {
    // AMOUNT has a <shadow> of 1 and a <block> reading "Initial Stake" = 0.35.
    // Taking the shadow would silently trade at 3x the intended size.
    const { strategy } = importDbotXml(LEGACY);
    assert.equal(
      strategy.staking.type === "martingale" ? strategy.staking.base : null,
      0.35
    );
  });

  it("detects a martingale multiplier from after_purchase", () => {
    const { strategy } = importDbotXml(LEGACY);
    assert.equal(strategy.staking.type, "martingale");
    assert.equal(strategy.staking.type === "martingale" && strategy.staking.multiplier, 2);
  });

  it("caps an imported martingale ladder", () => {
    // The file states no ceiling; importing without one is how an account dies.
    const { strategy } = importDbotXml(LEGACY);
    assert.ok(strategy.staking.type === "martingale" && strategy.staking.maxSteps <= 5);
    assert.ok(strategy.limits.maxStake !== undefined);
  });

  it("imports the modern nested trade_definition layout", () => {
    const { strategy, warnings } = importDbotXml(MODERN);
    assert.equal(strategy.symbol, "R_100");
    // No literal purchase blocks — types come from the declared trade type.
    assert.equal(strategy.contract.contractType, "DIGITEVEN");
    assert.equal(strategy.contractAlt?.contractType, "DIGITODD");
    assert.ok(warnings.some((w) => w.code === "assumed-value"));
  });

  it("always flags an import as needing review", () => {
    // Entry logic is a Blockly program we do not interpret. Running the import
    // as-is would trade on every tick, which is not what the author wrote.
    const r = importDbotXml(LEGACY);
    assert.equal(r.needsReview, true);
    assert.ok(r.warnings.some((w) => w.code === "entry-logic-not-imported"));
  });

  it("reports the blocks it ignored", () => {
    const r = importDbotXml(LEGACY);
    assert.ok(r.ignoredBlocks.includes("math_arithmetic"));
  });

  it("fails clearly on files that aren't DBot strategies", () => {
    assert.throws(() => importDbotXml(`<xml><block type="text"/></xml>`), DbotImportError);
    assert.throws(() => importDbotXml(`not xml at all`), DbotImportError);
  });

  it("fails when a trade definition names no market", () => {
    const noMarket = `<xml><block type="trade"><field name="TYPE_LIST">both</field></block></xml>`;
    assert.throws(() => importDbotXml(noMarket), DbotImportError);
  });
});

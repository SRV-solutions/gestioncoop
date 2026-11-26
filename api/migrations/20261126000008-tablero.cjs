'use strict';

/** Fase 7: tablero de gerencia — energía que entra a la red cada mes (comprada + generada), para el balance contra lo facturado. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, SMALLINT, STRING, DATE, DECIMAL } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });

      await queryInterface.createTable(
        'balance_energia',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: { type: INTEGER, allowNull: false, references: { model: 'cooperativas', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
          anio: { type: SMALLINT, allowNull: false },
          mes: { type: SMALLINT, allowNull: false },
          // kWh comprados al distribuidor mayorista y kWh de generación propia.
          comprada_kwh: { type: DECIMAL(14, 2), allowNull: false },
          generada_kwh: { type: DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          nota: { type: STRING(200), allowNull: true },
          cargado_por: { type: INTEGER, allowNull: true, references: { model: 'usuarios', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
          actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await sql(`ALTER TABLE balance_energia ADD CONSTRAINT balance_energia_mes_valido CHECK (mes BETWEEN 1 AND 12)`);
      await sql(`ALTER TABLE balance_energia ADD CONSTRAINT balance_energia_kwh_valido CHECK (comprada_kwh >= 0 AND generada_kwh >= 0)`);
      await queryInterface.addIndex('balance_energia', ['cooperativa_id', 'anio', 'mes'], { unique: true, name: 'balance_energia_mes_unico', transaction });

      // El libro de ventas busca por fecha de emisión (por mes y por fecha de cobro ya había índices).
      await sql(`CREATE INDEX comprobantes_emision_idx ON comprobantes (cooperativa_id, emitido_el) WHERE estado <> 'borrador'`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });
      await sql(`DROP INDEX IF EXISTS comprobantes_emision_idx`);
      await queryInterface.dropTable('balance_energia', { transaction });
    });
  },
};

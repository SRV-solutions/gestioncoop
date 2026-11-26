'use strict';

/**
 * Panel de SRV.
 * - comisiones_srv: lo que SRV le cobra a cada cooperativa por cada factura que emite (un porcentaje y, si se
 *   quiere, un monto fijo por factura). Va por vigencias, como las tarifas: un cambio rige desde una fecha y
 *   lo ya emitido conserva la comisión de su momento.
 * - cooperativa_imagenes pasa a guardar dos imágenes por cooperativa: el isotipo (cuadrado, para la app) y el
 *   logo de la factura (con sus proporciones).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, DATE, DATEONLY, DECIMAL } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });

      await queryInterface.createTable(
        'comisiones_srv',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: { type: INTEGER, allowNull: false, references: { model: 'cooperativas', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
          desde: { type: DATEONLY, allowNull: false },
          // Porcentaje sobre el total de cada factura (0,8 = 0,8 %).
          porcentaje: { type: DECIMAL(6, 3), allowNull: false },
          fijo_por_factura: { type: DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          nota: { type: STRING(200), allowNull: true },
          cargado_por: { type: INTEGER, allowNull: true, references: { model: 'usuarios', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
          actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await sql(`ALTER TABLE comisiones_srv ADD CONSTRAINT comisiones_srv_valores CHECK (porcentaje >= 0 AND porcentaje <= 10 AND fijo_por_factura >= 0)`);
      await sql(`CREATE UNIQUE INDEX comisiones_srv_desde ON comisiones_srv (cooperativa_id, desde)`);

      await sql(`ALTER TABLE cooperativa_imagenes ADD COLUMN tipo varchar(20) NOT NULL DEFAULT 'isotipo'`);
      await sql(`ALTER TABLE cooperativa_imagenes DROP CONSTRAINT cooperativa_imagenes_pkey`);
      await sql(`ALTER TABLE cooperativa_imagenes ADD PRIMARY KEY (cooperativa_id, tipo)`);
      await sql(`ALTER TABLE cooperativa_imagenes ADD CONSTRAINT cooperativa_imagenes_tipo CHECK (tipo IN ('isotipo', 'factura'))`);
      await sql(`ALTER TABLE cooperativa_imagenes ALTER COLUMN tipo DROP DEFAULT`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });
      await sql(`DELETE FROM cooperativa_imagenes WHERE tipo <> 'isotipo'`);
      await sql(`ALTER TABLE cooperativa_imagenes DROP CONSTRAINT cooperativa_imagenes_tipo`);
      await sql(`ALTER TABLE cooperativa_imagenes DROP CONSTRAINT cooperativa_imagenes_pkey`);
      await sql(`ALTER TABLE cooperativa_imagenes ADD PRIMARY KEY (cooperativa_id)`);
      await sql(`ALTER TABLE cooperativa_imagenes DROP COLUMN tipo`);
      await queryInterface.dropTable('comisiones_srv', { transaction });
    });
  },
};

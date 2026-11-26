'use strict';

/** Fase 3: lecturas en campo — períodos, lecturas (con su foto) y cantidad de dígitos de cada medidor. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, SMALLINT, STRING, BOOLEAN, DATE, DECIMAL, UUID, BLOB } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');
    const ref = (model, onDelete = 'RESTRICT') => ({ references: { model, key: 'id' }, onDelete, onUpdate: 'CASCADE' });
    const cooperativaId = { type: INTEGER, allowNull: false, ...ref('cooperativas') };
    const timestamps = {
      creado_el: { type: DATE, allowNull: false, defaultValue: now },
      actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
    };

    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });
      const check = (table, name, expr) => sql(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr})`);

      // Cuántos dígitos tiene el contador: hace falta para calcular el consumo cuando da la vuelta (99999 → 00000).
      await queryInterface.addColumn('medidores', 'digitos', { type: SMALLINT, allowNull: false, defaultValue: 5 }, { transaction });
      await check('medidores', 'medidores_digitos_validos', 'digitos BETWEEN 4 AND 9');

      // Un período = un mes de un servicio. La lectura, la facturación y el cierre avanzan por estado.
      await queryInterface.createTable(
        'periodos',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          servicio: { type: STRING(12), allowNull: false },
          anio: { type: SMALLINT, allowNull: false },
          mes: { type: SMALLINT, allowNull: false },
          estado: { type: STRING(14), allowNull: false, defaultValue: 'abierto' },
          ...timestamps,
        },
        { transaction },
      );
      await check('periodos', 'periodos_mes_valido', 'mes BETWEEN 1 AND 12');
      await check('periodos', 'periodos_estado_valido', "estado IN ('abierto','en_lectura','prefacturado','emitido','cerrado')");
      await queryInterface.addIndex('periodos', ['cooperativa_id', 'servicio', 'anio', 'mes'], { unique: true, name: 'periodos_unico', transaction });

      await queryInterface.createTable(
        'lecturas',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          // Lo genera el teléfono: si el envío se reintenta, la lectura no se duplica.
          uuid_dispositivo: { type: UUID, allowNull: false },
          periodo_id: { type: INTEGER, allowNull: false, ...ref('periodos') },
          medidor_id: { type: INTEGER, allowNull: false, ...ref('medidores') },
          valor: { type: DECIMAL(12, 2), allowNull: true }, // null = no se pudo leer (hay novedad)
          anterior: { type: DECIMAL(12, 2), allowNull: true },
          consumo: { type: DECIMAL(14, 2), allowNull: true },
          tipo: { type: STRING(10), allowNull: false, defaultValue: 'real' },
          motivo: { type: STRING(20), allowNull: true }, // por qué es menor a la anterior
          novedad: { type: STRING(20), allowNull: true },
          anomalia: { type: STRING(16), allowNull: true },
          nota: { type: STRING(300), allowNull: true },
          tiene_foto: { type: BOOLEAN, allowNull: false, defaultValue: false },
          lat: { type: DECIMAL(9, 6), allowNull: true },
          lng: { type: DECIMAL(9, 6), allowNull: true },
          precision_m: { type: INTEGER, allowNull: true },
          tomada_el: { type: DATE, allowNull: false },
          operario_id: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          sincronizada_el: { type: DATE, allowNull: false, defaultValue: now },
          // La oficina ya miró la anomalía o la novedad.
          revisada_el: { type: DATE, allowNull: true },
          revisada_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
        },
        { transaction },
      );
      await check('lecturas', 'lecturas_tipo_valido', "tipo IN ('real','estimada')");
      await check('lecturas', 'lecturas_motivo_valido', "motivo IS NULL OR motivo IN ('vuelta_contador','cambio_medidor')");
      await check(
        'lecturas',
        'lecturas_novedad_valida',
        "novedad IS NULL OR novedad IN ('medidor_roto','sin_acceso','perro','casa_cerrada','posible_fraude','perdida_visible')",
      );
      await check('lecturas', 'lecturas_anomalia_valida', "anomalia IS NULL OR anomalia IN ('lectura_menor','consumo_alto','consumo_bajo','sin_consumo')");
      await check('lecturas', 'lecturas_con_dato', 'valor IS NOT NULL OR novedad IS NOT NULL');
      await queryInterface.addIndex('lecturas', ['cooperativa_id', 'uuid_dispositivo'], { unique: true, name: 'lecturas_uuid_unico', transaction });
      // Una lectura por medidor y período: una corrección reemplaza a la anterior.
      await queryInterface.addIndex('lecturas', ['periodo_id', 'medidor_id'], { unique: true, name: 'lecturas_medidor_periodo_unico', transaction });
      await queryInterface.addIndex('lecturas', ['medidor_id', 'tomada_el'], { name: 'lecturas_medidor_idx', transaction });
      await queryInterface.addIndex('lecturas', ['cooperativa_id', 'periodo_id', 'anomalia'], { name: 'lecturas_anomalia_idx', transaction });

      // La foto va aparte para no arrastrarla en cada consulta de lecturas.
      await queryInterface.createTable(
        'lectura_fotos',
        {
          lectura_id: { type: INTEGER, primaryKey: true, ...ref('lecturas', 'CASCADE') },
          cooperativa_id: cooperativaId,
          mime: { type: STRING(40), allowNull: false },
          contenido: { type: BLOB, allowNull: false },
          ...timestamps,
        },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of ['lectura_fotos', 'lecturas', 'periodos']) await queryInterface.dropTable(table, { transaction });
      await queryInterface.removeColumn('medidores', 'digitos', { transaction });
    });
  },
};

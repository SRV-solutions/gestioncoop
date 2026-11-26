'use strict';

/** Fase 2: tarifas — cuadros tarifarios versionados, sus escalones y los conceptos configurables. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, BOOLEAN, DATE, DATEONLY, DECIMAL, JSONB } = Sequelize;
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

      // Un cuadro = cuota fija + escalones para un servicio, una categoría y un rango de fechas.
      // Nunca se edita: cuando cambia la tarifa se crea otro, con otra fecha de vigencia.
      await queryInterface.createTable(
        'cuadros_tarifarios',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          servicio: { type: STRING(12), allowNull: false },
          categoria: { type: STRING(16), allowNull: true }, // sepelio no tiene categorías
          con_subsidio: { type: BOOLEAN, allowNull: false, defaultValue: false },
          vigente_desde: { type: DATEONLY, allowNull: false },
          vigente_hasta: { type: DATEONLY, allowNull: true }, // último día en que rige; null = vigente
          cargo_fijo: { type: DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          nota: { type: STRING(200), allowNull: true },
          creado_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
        },
        { transaction },
      );
      await check('cuadros_tarifarios', 'cuadros_servicio_valido', "servicio IN ('energia','agua','sepelio')");
      await check('cuadros_tarifarios', 'cuadros_vigencia_valida', 'vigente_hasta IS NULL OR vigente_hasta >= vigente_desde');
      await check('cuadros_tarifarios', 'cuadros_cargo_fijo_valido', 'cargo_fijo >= 0');
      // Con COALESCE, porque para Postgres dos NULL nunca son iguales y sepelio no lleva categoría.
      await sql(
        "CREATE UNIQUE INDEX cuadros_version_unica ON cuadros_tarifarios (cooperativa_id, servicio, COALESCE(categoria, ''), con_subsidio, vigente_desde)",
      );

      await queryInterface.createTable(
        'escalones',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          cuadro_id: { type: INTEGER, allowNull: false, ...ref('cuadros_tarifarios', 'CASCADE') },
          desde: { type: DECIMAL(12, 4), allowNull: false },
          hasta: { type: DECIMAL(12, 4), allowNull: true }, // null = sin tope (excedente)
          precio_unitario: { type: DECIMAL(14, 4), allowNull: false },
          subsidiado: { type: BOOLEAN, allowNull: false, defaultValue: false },
          // Códigos de conceptos que no se calculan sobre este escalón.
          exento_de: { type: JSONB, allowNull: false, defaultValue: [] },
          ...timestamps,
        },
        { transaction },
      );
      await check('escalones', 'escalones_rango_valido', 'desde >= 0 AND (hasta IS NULL OR hasta > desde)');
      await check('escalones', 'escalones_precio_valido', 'precio_unitario >= 0');
      await queryInterface.addIndex('escalones', ['cuadro_id', 'desde'], { unique: true, name: 'escalones_desde_unico', transaction });

      // Impuestos, tasas y cargos. Cambiar un valor = una fila nueva con el mismo código y otra fecha.
      await queryInterface.createTable(
        'conceptos',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          codigo: { type: STRING(24), allowNull: false },
          nombre: { type: STRING(80), allowNull: false },
          tipo: { type: STRING(12), allowNull: false },
          valor: { type: DECIMAL(16, 6), allowNull: false },
          base: { type: STRING(12), allowNull: true }, // solo para porcentajes
          grupo: { type: STRING(12), allowNull: false },
          aplica_a: { type: STRING(12), allowNull: true }, // servicio; null = todos
          categorias: { type: JSONB, allowNull: true }, // null = todas
          condiciones_iva: { type: JSONB, allowNull: true }, // null = todas
          orden: { type: INTEGER, allowNull: false, defaultValue: 100 },
          vigente_desde: { type: DATEONLY, allowNull: false },
          vigente_hasta: { type: DATEONLY, allowNull: true },
          creado_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
        },
        { transaction },
      );
      await check('conceptos', 'conceptos_tipo_valido', "tipo IN ('porcentaje','fijo','por_unidad')");
      await check('conceptos', 'conceptos_base_valida', "(tipo = 'porcentaje' AND base IN ('basico','subtotal','recargos')) OR (tipo <> 'porcentaje' AND base IS NULL)");
      await check('conceptos', 'conceptos_grupo_valido', "grupo IN ('cargo','gravamen','adicional')");
      await check('conceptos', 'conceptos_valor_valido', 'valor >= 0');
      await check('conceptos', 'conceptos_vigencia_valida', 'vigente_hasta IS NULL OR vigente_hasta >= vigente_desde');
      await queryInterface.addIndex('conceptos', ['cooperativa_id', 'codigo', 'vigente_desde'], { unique: true, name: 'conceptos_version_unica', transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of ['conceptos', 'escalones', 'cuadros_tarifarios']) {
        await queryInterface.dropTable(table, { transaction });
      }
    });
  },
};

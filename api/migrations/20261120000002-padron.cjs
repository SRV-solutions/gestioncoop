'use strict';

/** Fase 1: padrón — socios, zonas, rutas, conexiones, planes, servicios por conexión, medidores y sepelio. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, SMALLINT, STRING, BOOLEAN, DATE, DATEONLY, DECIMAL, JSONB } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');
    const ref = (model, onDelete = 'RESTRICT') => ({ references: { model, key: 'id' }, onDelete, onUpdate: 'CASCADE' });
    // Todas las tablas de negocio llevan cooperativa_id (SPEC sección 7).
    const cooperativaId = { type: INTEGER, allowNull: false, ...ref('cooperativas') };
    const timestamps = {
      creado_el: { type: DATE, allowNull: false, defaultValue: now },
      actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
    };

    await queryInterface.sequelize.transaction(async (transaction) => {
      const check = (table, name, expr) =>
        queryInterface.sequelize.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr})`, { transaction });

      await queryInterface.createTable(
        'socios',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          numero: { type: INTEGER, allowNull: false },
          tipo_doc: { type: STRING(4), allowNull: false },
          nro_doc: { type: STRING(11), allowNull: false },
          nombre: { type: STRING(160), allowNull: false },
          // Nombre en minúsculas y sin acentos, para buscar "benitez" y encontrar "Benítez".
          nombre_norm: { type: STRING(160), allowNull: false },
          condicion_iva: { type: STRING(24), allowNull: false },
          email: { type: STRING(200), allowNull: true },
          telefono: { type: STRING(40), allowNull: true },
          estado: { type: STRING(12), allowNull: false, defaultValue: 'activo' },
          usuario_id: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
          eliminado_el: { type: DATE, allowNull: true }, // borrado lógico
        },
        { transaction },
      );
      await check('socios', 'socios_tipo_doc_valido', "tipo_doc IN ('DNI','CUIT')");
      await check('socios', 'socios_estado_valido', "estado IN ('activo','baja')");
      await queryInterface.addIndex('socios', ['cooperativa_id', 'numero'], { unique: true, name: 'socios_numero_unico', transaction });
      await queryInterface.addIndex('socios', ['cooperativa_id', 'nro_doc'], { name: 'socios_doc_idx', transaction });
      await queryInterface.addIndex('socios', ['cooperativa_id', 'nombre_norm'], { name: 'socios_nombre_idx', transaction });

      await queryInterface.createTable(
        'zonas',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          nombre: { type: STRING(80), allowNull: false },
          tipo: { type: STRING(8), allowNull: false },
          poligono_geojson: { type: JSONB, allowNull: true },
          ...timestamps,
        },
        { transaction },
      );
      await check('zonas', 'zonas_tipo_valido', "tipo IN ('urbana','rural')");
      await queryInterface.addIndex('zonas', ['cooperativa_id', 'nombre'], { unique: true, name: 'zonas_nombre_unico', transaction });

      await queryInterface.createTable(
        'rutas',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          zona_id: { type: INTEGER, allowNull: false, ...ref('zonas') },
          nombre: { type: STRING(80), allowNull: false },
          operario_id: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('rutas', ['cooperativa_id', 'zona_id'], { name: 'rutas_zona_idx', transaction });

      await queryInterface.createTable(
        'conexiones',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          socio_id: { type: INTEGER, allowNull: false, ...ref('socios') },
          numero: { type: INTEGER, allowNull: false },
          direccion: { type: STRING(200), allowNull: false },
          direccion_norm: { type: STRING(200), allowNull: false },
          zona_id: { type: INTEGER, allowNull: true, ...ref('zonas', 'SET NULL') },
          ruta_id: { type: INTEGER, allowNull: true, ...ref('rutas', 'SET NULL') },
          orden_ruta: { type: INTEGER, allowNull: true },
          // Ubicación: opcional, porque no toda cooperativa tiene el padrón georreferenciado.
          lat: { type: DECIMAL(9, 6), allowNull: true },
          lng: { type: DECIMAL(9, 6), allowNull: true },
          // Rumbo de la calle frente a la casa (0-179°). Solo sirve para dibujarla alineada en el mapa.
          orientacion: { type: SMALLINT, allowNull: true },
          ...timestamps,
          eliminado_el: { type: DATE, allowNull: true },
        },
        { transaction },
      );
      await queryInterface.addIndex('conexiones', ['cooperativa_id', 'numero'], { unique: true, name: 'conexiones_numero_unico', transaction });
      await queryInterface.addIndex('conexiones', ['cooperativa_id', 'socio_id'], { name: 'conexiones_socio_idx', transaction });
      await queryInterface.addIndex('conexiones', ['cooperativa_id', 'ruta_id', 'orden_ruta'], { name: 'conexiones_ruta_idx', transaction });
      await queryInterface.addIndex('conexiones', ['cooperativa_id', 'zona_id'], { name: 'conexiones_zona_idx', transaction });
      await queryInterface.addIndex('conexiones', ['cooperativa_id', 'direccion_norm'], { name: 'conexiones_direccion_idx', transaction });

      await queryInterface.createTable(
        'planes',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          servicio: { type: STRING(12), allowNull: false },
          nombre: { type: STRING(80), allowNull: false },
          precio: { type: DECIMAL(14, 2), allowNull: false },
          activo: { type: BOOLEAN, allowNull: false, defaultValue: true },
          ...timestamps,
        },
        { transaction },
      );

      await queryInterface.createTable(
        'servicios_conexion',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          conexion_id: { type: INTEGER, allowNull: false, ...ref('conexiones') },
          servicio: { type: STRING(12), allowNull: false },
          categoria: { type: STRING(16), allowNull: true },
          plan_id: { type: INTEGER, allowNull: true, ...ref('planes') },
          estado: { type: STRING(12), allowNull: false, defaultValue: 'activo' },
          fecha_alta: { type: DATEONLY, allowNull: false },
          fecha_baja: { type: DATEONLY, allowNull: true },
          tiene_subsidio: { type: BOOLEAN, allowNull: false, defaultValue: false },
          ...timestamps,
        },
        { transaction },
      );
      await check('servicios_conexion', 'servicios_servicio_valido', "servicio IN ('energia','agua','internet','tv','sepelio')");
      await check('servicios_conexion', 'servicios_estado_valido', "estado IN ('activo','suspendido','cortado','baja')");
      await queryInterface.addIndex('servicios_conexion', ['conexion_id', 'servicio'], { unique: true, name: 'servicios_conexion_unico', transaction });
      await queryInterface.addIndex('servicios_conexion', ['cooperativa_id', 'servicio', 'estado'], { name: 'servicios_estado_idx', transaction });

      await queryInterface.createTable(
        'medidores',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          servicio_conexion_id: { type: INTEGER, allowNull: false, ...ref('servicios_conexion') },
          numero: { type: STRING(20), allowNull: false },
          tipo: { type: STRING(40), allowNull: false },
          factor_mult: { type: DECIMAL(8, 2), allowNull: false, defaultValue: 1 },
          instalado_el: { type: DATEONLY, allowNull: false },
          retirado_el: { type: DATEONLY, allowNull: true }, // con fecha = medidor anterior (historial de cambios)
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('medidores', ['cooperativa_id', 'numero'], { name: 'medidores_numero_idx', transaction });
      await queryInterface.addIndex('medidores', ['servicio_conexion_id'], { name: 'medidores_servicio_idx', transaction });

      await queryInterface.createTable(
        'beneficiarios_sepelio',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          socio_id: { type: INTEGER, allowNull: false, ...ref('socios') },
          nombre: { type: STRING(160), allowNull: false },
          nro_doc: { type: STRING(11), allowNull: false },
          parentesco: { type: STRING(24), allowNull: false },
          alta_el: { type: DATEONLY, allowNull: false },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('beneficiarios_sepelio', ['cooperativa_id', 'socio_id'], { name: 'beneficiarios_socio_idx', transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of ['beneficiarios_sepelio', 'medidores', 'servicios_conexion', 'planes', 'conexiones', 'rutas', 'zonas', 'socios']) {
        await queryInterface.dropTable(table, { transaction });
      }
    });
  },
};

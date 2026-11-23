// Three.js r187 - Node System

// global
diagnostic( off, derivative_uniformity );


// directives


// structs

struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;

// uniforms
@binding( 0 ) @group( 1 ) var nodeUniform4 : texture_2d<f32>;

struct objectStruct {
	nodeUniform0 : vec3<f32>,
	nodeUniform1 : vec3<f32>,
	nodeUniform2 : f32,
	nodeUniform3 : vec3<f32>,
	nodeUniform5 : vec3<f32>,
	nodeUniform6 : f32,
	nodeUniform10 : mat3x3<f32>,
	nodeUniform16 : mat4x4<f32>
};
@binding( 1 ) @group( 1 )
var<uniform> object : objectStruct;

struct renderStruct {
	cameraProjectionMatrix : mat4x4<f32>,
	cameraViewMatrix : mat4x4<f32>,
	nodeUniform8 : vec3<f32>,
	nodeUniform12 : vec3<f32>,
	nodeUniform7 : vec3<f32>,
	nodeUniform13 : vec3<f32>,
	nodeUniform14 : f32,
	nodeUniform15 : f32
};
@binding( 0 ) @group( 0 )
var<uniform> render : renderStruct;

// vars
var<private> DiffuseColor : vec4<f32>;
var<private> nodeVar1 : vec4<f32>;
var<private> nodeVar2 : vec4<f32>;
var<private> nodeVar3 : vec2<u32>;
var<private> nodeVar4 : vec4<f32>;
var<private> nodeVar5 : f32;
var<private> nodeVar6 : vec4<f32>;
var<private> nodeVar7 : vec4<f32>;
var<private> nodeVar8 : vec4<f32>;
var<private> nodeVar9 : f32;
var<private> nodeVar10 : vec4<f32>;
var<private> nodeVar11 : vec4<f32>;
var<private> nodeVar12 : vec4<f32>;
var<private> nodeVar13 : f32;
var<private> nodeVar14 : vec4<f32>;
var<private> nodeVar15 : f32;
var<private> nodeVar16 : vec4<f32>;
var<private> nodeVar17 : f32;
var<private> nodeVar18 : vec4<f32>;
var<private> nodeVar19 : f32;
var<private> Output : vec4<f32>;
var<private> irradiance : vec3<f32>;
var<private> normalViewGeometry : vec3<f32>;
var<private> normalView : vec3<f32>;
var<private> normalWorld : vec3<f32>;
var<private> indirectDiffuse : vec3<f32>;
var<private> ambientOcclusion : f32;
var<private> totalDiffuse : vec3<f32>;
var<private> directDiffuse : vec3<f32>;
var<private> totalSpecular : vec3<f32>;
var<private> directSpecular : vec3<f32>;
var<private> indirectSpecular : vec3<f32>;
var<private> outgoingLight : vec3<f32>;
var<private> nodeVar20 : vec4<f32>;

// codes
fn tsl_clampWrapping_float( coord: f32 ) -> f32 { return clamp( coord, 0.0, 1.0 ); }
fn tsl_coord_clampS_clampT_2d( coord : vec2f ) -> vec2f {

	return vec2f(
		tsl_clampWrapping_float( coord.x ),
		tsl_clampWrapping_float( coord.y )
	);

}

fn tsl_mod_vec2( x : vec2f, y : vec2f ) -> vec2f { return x - y * floor( x / y ); }


@fragment
fn main( @location( 0 ) v_positionView : vec3<f32>,
	@location( 1 ) nodeVarying3 : vec2<f32>,
	@location( 2 ) @interpolate( flat ) nodeVarying4 : vec4<f32>,
	@location( 3 ) nodeVarying5 : vec4<f32>,
	@location( 4 ) nodeVarying6 : vec3<f32>,
	@location( 5 ) v_normalViewGeometry : vec3<f32>,
	@builtin( position ) fragCoord : vec4<f32> ) -> OutputStruct {

	// flow
	// code

	nodeVar1 = vec4<f32>( 0.0, 0.0, 0.0, 0.0 );
	let nodeConst3 = dpdx( nodeVarying3 );
	let nodeConst4 = vec2<f32>( textureDimensions( nodeUniform4, 0 ) );
	let nodeConst5 = - dpdy( nodeVarying3 );
	let nodeConst6 = max( length( ( nodeConst3 * nodeConst4 ) ), length( ( nodeConst5 * nodeConst4 ) ) );

	if ( ( nodeConst6 < 1.3 ) ) {

		nodeVar3 = textureDimensions( nodeUniform4, u32( 0.0 ) );
		nodeVar2 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeVarying3 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );
		nodeVar1 = nodeVar2;
		

	} else {


		if ( ( nodeConst6 < 2.3 ) ) {

			nodeVar5 = 2.0;

		} else {

			nodeVar5 = 3.0;

		}

		let nodeConst7 = ( ( vec2<f32>( 0.5, 0.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst8 = ( vec2<f32>( 0.5, 0.5 ) / nodeConst4 );
		let nodeConst9 = ( min( nodeVarying4.xy, nodeVarying4.zw ) + nodeConst8 );
		let nodeConst10 = ( max( nodeVarying4.xy, nodeVarying4.zw ) - nodeConst8 );
		let nodeConst11 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst7.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst7.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar3 = textureDimensions( nodeUniform4, u32( 0.0 ) );
		nodeVar6 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst11 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );
		let nodeConst12 = ( ( vec2<f32>( 1.5, 0.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst13 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst12.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst12.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar7 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst13 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );
		let nodeConst14 = ( ( vec2<f32>( 2.5, 0.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst15 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst14.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst14.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar8 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst15 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );

		if ( ( nodeVar5 > 2.5 ) ) {

			nodeVar9 = 1.0;

		} else {

			nodeVar9 = 0.0;

		}

		let nodeConst16 = ( ( vec2<f32>( 0.5, 1.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst17 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst16.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst16.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar10 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst17 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );
		let nodeConst18 = ( ( vec2<f32>( 1.5, 1.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst19 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst18.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst18.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar11 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst19 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );
		let nodeConst20 = ( ( vec2<f32>( 2.5, 1.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst21 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst20.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst20.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar12 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst21 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );

		if ( ( nodeVar5 > 2.5 ) ) {

			nodeVar13 = 1.0;

		} else {

			nodeVar13 = 0.0;

		}

		let nodeConst22 = ( ( vec2<f32>( 0.5, 2.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst23 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst22.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst22.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar14 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst23 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );

		if ( ( nodeVar5 > 2.5 ) ) {

			nodeVar15 = 1.0;

		} else {

			nodeVar15 = 0.0;

		}

		let nodeConst24 = ( ( vec2<f32>( 1.5, 2.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst25 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst24.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst24.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar16 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst25 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );

		if ( ( nodeVar5 > 2.5 ) ) {

			nodeVar17 = 1.0;

		} else {

			nodeVar17 = 0.0;

		}

		let nodeConst26 = ( ( vec2<f32>( 2.5, 2.5 ) / vec2<f32>( nodeVar5 ) ) - vec2<f32>( 0.5 ) );
		let nodeConst27 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2<f32>( nodeConst26.x ) ) ) + ( nodeConst5 * vec2<f32>( nodeConst26.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar18 = textureLoad( nodeUniform4, vec2<u32>( clamp( floor( tsl_coord_clampS_clampT_2d( nodeConst27 ) * vec2<f32>( nodeVar3 ) ), vec2<f32>( 0 ), vec2<f32>( nodeVar3 - vec2<u32>( 1, 1 ) ) ) ), u32( 0.0 ) );

		if ( ( nodeVar5 > 2.5 ) ) {

			nodeVar19 = 1.0;

		} else {

			nodeVar19 = 0.0;

		}

		let nodeConst28 = ( ( ( ( ( ( ( ( ( ( vec4<f32>( 0.0, 0.0, 0.0, 0.0 ) + ( vec4<f32>( ( nodeVar6.xyz * vec3<f32>( nodeVar6.w ) ), nodeVar6.w ) * vec4<f32>( 1.0 ) ) ) + ( vec4<f32>( ( nodeVar7.xyz * vec3<f32>( nodeVar7.w ) ), nodeVar7.w ) * vec4<f32>( 1.0 ) ) ) + ( vec4<f32>( ( nodeVar8.xyz * vec3<f32>( nodeVar8.w ) ), nodeVar8.w ) * vec4<f32>( nodeVar9 ) ) ) + ( vec4<f32>( ( nodeVar10.xyz * vec3<f32>( nodeVar10.w ) ), nodeVar10.w ) * vec4<f32>( 1.0 ) ) ) + ( vec4<f32>( ( nodeVar11.xyz * vec3<f32>( nodeVar11.w ) ), nodeVar11.w ) * vec4<f32>( 1.0 ) ) ) + ( vec4<f32>( ( nodeVar12.xyz * vec3<f32>( nodeVar12.w ) ), nodeVar12.w ) * vec4<f32>( nodeVar13 ) ) ) + ( vec4<f32>( ( nodeVar14.xyz * vec3<f32>( nodeVar14.w ) ), nodeVar14.w ) * vec4<f32>( nodeVar15 ) ) ) + ( vec4<f32>( ( nodeVar16.xyz * vec3<f32>( nodeVar16.w ) ), nodeVar16.w ) * vec4<f32>( nodeVar17 ) ) ) + ( vec4<f32>( ( nodeVar18.xyz * vec3<f32>( nodeVar18.w ) ), nodeVar18.w ) * vec4<f32>( nodeVar19 ) ) ) / vec4<f32>( ( nodeVar5 * nodeVar5 ) ) );

		if ( ( nodeConst28.w > 0.0 ) ) {

			nodeVar4 = vec4<f32>( ( nodeConst28.xyz / vec3<f32>( nodeConst28.w ) ), nodeConst28.w );

		} else {

			nodeVar4 = vec4<f32>( 0.0, 0.0, 0.0, 0.0 );

		}

		nodeVar1 = nodeVar4;
		

	}


	if ( ( nodeVar1.w < 0.5 ) ) {

		discard;
		

	}

	let nodeConst29 = tsl_mod_vec2( floor( fragCoord.xy ), vec2<f32>( 4.0 ) );

	if ( ( ( nodeVarying5.y > 0.0 ) && ( ( ( ( nodeConst29.x * 4.0 ) + nodeConst29.y ) / 16.0 ) < nodeVarying5.y ) ) ) {

		discard;
		

	}

	DiffuseColor = vec4<f32>( mix( min( ( ( nodeVar1.xyz * nodeVarying6 ) * object.nodeUniform5 ), vec3<f32>( 1.0, 1.0, 1.0 ) ), vec3<f32>( 1.0, 1.0, 1.0 ), nodeVarying5.x ), 1.0 );
	DiffuseColor.w = ( DiffuseColor.w * object.nodeUniform6 );
	DiffuseColor.w = 1.0;
	irradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	normalViewGeometry = normalize( v_normalViewGeometry );
	normalView = normalViewGeometry;
	normalWorld = normalize( ( vec4<f32>( normalView, 0.0 ) * render.cameraViewMatrix ).xyz );
	irradiance = ( irradiance + mix( render.nodeUniform7, render.nodeUniform8, ( ( dot( normalWorld, normalize( render.nodeUniform12 ) ) * 0.5 ) + 0.5 ) ) );
	indirectDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	indirectDiffuse = vec4<f32>( 0.0, 0.0, 0.0, 0.0 ).xyz;
	indirectDiffuse = ( vec4<f32>( indirectDiffuse, 1.0 ) + vec4<f32>( 1.0, 1.0, 1.0, 0.0 ) ).xyz;
	ambientOcclusion = 1.0;
	indirectDiffuse = ( indirectDiffuse * vec3<f32>( ambientOcclusion ) );
	indirectDiffuse = ( indirectDiffuse * DiffuseColor.xyz );
	directDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	totalDiffuse = ( directDiffuse + indirectDiffuse );
	directSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	indirectSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	totalSpecular = ( directSpecular + indirectSpecular );
	outgoingLight = ( totalDiffuse + totalSpecular );
	Output = max( vec4<f32>( outgoingLight, DiffuseColor.w ), vec4<f32>( 0.0 ) );
	nodeVar20 = vec4<f32>( mix( Output.xyz, render.nodeUniform13, smoothstep( render.nodeUniform14, render.nodeUniform15, ( - v_positionView.z ) ) ), Output.w );
	let nodeConst30 = nodeVar20;
	Output = nodeConst30;

	// result

	output.color = nodeConst30;

	return output;

}

//----VERTEX----
// Three.js r187 - Node System

// directives


// structs


// uniforms

struct objectStruct {
	nodeUniform0 : vec3<f32>,
	nodeUniform1 : vec3<f32>,
	nodeUniform2 : f32,
	nodeUniform3 : vec3<f32>,
	nodeUniform5 : vec3<f32>,
	nodeUniform6 : f32,
	nodeUniform10 : mat3x3<f32>,
	nodeUniform16 : mat4x4<f32>
};
@binding( 1 ) @group( 1 )
var<uniform> object : objectStruct;

struct renderStruct {
	cameraProjectionMatrix : mat4x4<f32>,
	cameraViewMatrix : mat4x4<f32>,
	nodeUniform8 : vec3<f32>,
	nodeUniform12 : vec3<f32>,
	nodeUniform7 : vec3<f32>,
	nodeUniform13 : vec3<f32>,
	nodeUniform14 : f32,
	nodeUniform15 : f32
};
@binding( 0 ) @group( 0 )
var<uniform> render : renderStruct;

// varyings

struct VaryingsStruct {
	@location( 0 ) v_positionView : vec3<f32>,
	@location( 1 ) nodeVarying3 : vec2<f32>,
	@location( 2 ) @interpolate( flat ) nodeVarying4 : vec4<f32>,
	@location( 3 ) nodeVarying5 : vec4<f32>,
	@location( 4 ) nodeVarying6 : vec3<f32>,
	@location( 5 ) v_normalViewGeometry : vec3<f32>,
	@builtin( position ) builtinClipSpace : vec4<f32>
};
var<private> varyings : VaryingsStruct;

// vars
var<private> nodeVar0 : f32;
var<private> normalLocal : vec3<f32>;
var<private> modelViewMatrix : mat4x4<f32>;
var<private> positionLocal : vec3<f32>;
var<private> v_modelViewProjection : vec4<f32>;
var<private> VERTEX_v_modelViewProjection : vec4<f32>;

// codes


@vertex
fn main( @location( 0 ) position : vec3<f32>,
	@location( 1 ) iA : vec4<f32>,
	@location( 2 ) iB : vec4<f32>,
	@location( 3 ) iC : vec4<f32>,
	@location( 4 ) iD : vec4<f32>,
	@location( 5 ) iUV : vec4<f32>,
	@location( 6 ) normal : vec3<f32> ) -> VaryingsStruct {

	// flow
	// code

	positionLocal = position;

	if ( ( object.nodeUniform2 > 0.0 ) ) {

		let nodeConst0 = ( iA.xyz - object.nodeUniform3 );
		let nodeConst1 = atan2( ( - nodeConst0.y ), length( nodeConst0.xz ) );
		nodeVar0 = ( sign( nodeConst1 ) * max( 0.0, ( abs( nodeConst1 ) - object.nodeUniform2 ) ) );

	} else {

		nodeVar0 = 0.0;

	}

	let nodeConst0 = ( iA.xyz - object.nodeUniform3 );
	positionLocal = ( ( ( ( iA.xyz + ( object.nodeUniform0 * vec3<f32>( ( ( ( ( ( ( position.xy.x + 0.5 ) * iB.x ) - iB.z ) / 16.0 ) * iA.w ) + iC.z ) ) ) ) + ( vec3<f32>( ( object.nodeUniform1.x * sin( nodeVar0 ) ), cos( nodeVar0 ), ( object.nodeUniform1.z * sin( nodeVar0 ) ) ) * vec3<f32>( ( ( ( ( ( ( ( position.xy.y * iB.y ) - ( iB.y - iB.w ) ) / 16.0 ) * iA.w ) * clamp( ( length( nodeConst0 ) / max( length( nodeConst0.xz ), 0.5 ) ), 1.0, 1.6 ) ) + iD.w ) - iD.w ) ) ) ) + vec3<f32>( 0.0, iD.w, 0.0 ) ) - ( object.nodeUniform1 * vec3<f32>( iC.w ) ) );
	let nodeConst2 = vec2<f32>( mix( iUV.x, iUV.z, ( position.xy.x + 0.5 ) ), mix( iUV.w, iUV.y, position.xy.y ) );
	varyings.nodeVarying3 = nodeConst2;
	varyings.nodeVarying4 = iUV;
	varyings.nodeVarying5 = iC;
	varyings.nodeVarying6 = iD.xyz;
	normalLocal = normal;
	varyings.v_normalViewGeometry = normalize( ( render.cameraViewMatrix * vec4<f32>( ( object.nodeUniform10 * normalLocal ), 0.0 ) ).xyz );
	modelViewMatrix = ( render.cameraViewMatrix * object.nodeUniform16 );
	varyings.v_positionView = ( modelViewMatrix * vec4<f32>( positionLocal, 1.0 ) ).xyz;
	let VERTEX_nodeConst31 = ( render.cameraProjectionMatrix * vec4<f32>( varyings.v_positionView, 1.0 ) );
	VERTEX_v_modelViewProjection = VERTEX_nodeConst31;

	// result

	varyings.builtinClipSpace = VERTEX_v_modelViewProjection;

	return varyings;

}
